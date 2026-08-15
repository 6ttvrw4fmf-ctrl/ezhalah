-- Generalize the three cohort-hardcoded barriers off شقة+سنوي onto a DATA-DRIVEN registry
-- (owner 2026-08-15, prerequisite for expanding beyond Annual Rent -> Apartment).
--
-- PROBLEM: mon_rich_attrs_barrier, mon_af_new_listing_readiness (checks A, B, C) and
-- mon_filter_parity_barrier check (2) hardcoded
-- deal_ar='إيجار' AND rent_period_ar='سنوي' AND type_ar='شقة'. Ship Villas or Buy and the alarms
-- keep watching apartments — blind exactly when the most is changing.
--
-- DESIGN: one registry table drives all of them. Adding a cohort ROW is the only action needed to
-- put a new property type under barrier protection; no barrier body is ever edited again.
-- rent_period_ar IS NULL means "any period" (correct for بيع, which has no period).
--
-- ROLLOUT SAFETY: seeded with exactly the one certified cohort, so every barrier must return
-- BYTE-IDENTICAL verdicts today; asserted below, aborts on any difference.
-- NOTE on the equality probe: mon_rich_attrs_barrier is STATEFUL — its drift check alarms only when
-- drift persists across two CONSECUTIVE runs (mon_rich_attrs_drift_state). Calling it twice inside
-- one transaction would therefore trip it by construction, so the state is snapshotted and restored
-- around each probe to keep the before/after comparison apples-to-apples and leave state untouched.

create table if not exists public.af_cohort_registry (
  deal_ar        text not null,
  rent_period_ar text,                       -- NULL = any period (بيع has none)
  type_ar        text not null,
  enabled        boolean not null default true,
  note           text,
  added_at       timestamptz not null default now()
);
create unique index if not exists af_cohort_registry_key
  on public.af_cohort_registry (deal_ar, coalesce(rent_period_ar,''), type_ar);

insert into public.af_cohort_registry (deal_ar, rent_period_ar, type_ar, note)
values ('إيجار','سنوي','شقة','Certified 2026-08-15 — the first fully verified cohort.')
on conflict do nothing;

create or replace function public.af_in_certified_cohort(p_deal text, p_period text, p_type text)
returns boolean language sql stable as $fn$
  select exists (
    select 1 from public.af_cohort_registry c
     where c.enabled
       and c.deal_ar = p_deal
       and c.type_ar = p_type
       and (c.rent_period_ar is null or c.rent_period_ar = p_period))
$fn$;

do $do$
declare
  src text; occ int;
  st_n int; st_w int;              -- snapshot of the stateful drift counters
  before_rich int; before_ready int; before_p2 bigint;
  after_rich int; after_ready int; after_p2 bigint;
  needle  text := $x$s.deal_ar='إيجار' and s.rent_period_ar='سنوي' and s.type_ar='شقة'$x$;
  repl    text := $x$public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar)$x$;
  needle2 text := $x$s.deal_ar = 'إيجار' and s.rent_period_ar = 'سنوي' and s.type_ar = 'شقة'$x$;
  p2_old  text := $x$  from public.location_search_candidates_ar(
         p_deal:='إيجار', p_rent_period:='سنوي', p_types:=array['شقة'], p_limit:=1000000) c
  join public.search_listings_ar s
    on s.source_table = c.source_table and s.listing_id = c.listing_id
  where not (s.rent_period_ar='سنوي'
             or (s.rent_period_ar='شهري' and coalesce(s.rent_now_pay_later,false)))$x$;
  p2_new  text := $x$  from public.af_cohort_registry reg
  cross join lateral public.location_search_candidates_ar(
         p_deal:=reg.deal_ar, p_rent_period:=reg.rent_period_ar,
         p_types:=array[reg.type_ar], p_limit:=1000000) c
  join public.search_listings_ar s
    on s.source_table = c.source_table and s.listing_id = c.listing_id
  where reg.enabled and reg.deal_ar='إيجار' and reg.rent_period_ar='سنوي'
    and not (s.rent_period_ar='سنوي'
             or (s.rent_period_ar='شهري' and coalesce(s.rent_now_pay_later,false)))$x$;
begin
  select ds.drift_n, ds.drift_wasalt into st_n, st_w
    from public.mon_rich_attrs_drift_state ds where ds.id = 1;

  select public.mon_rich_attrs_barrier() into before_rich;
  update public.mon_rich_attrs_drift_state set drift_n = st_n, drift_wasalt = st_w where id = 1;
  select public.mon_af_new_listing_readiness() into before_ready;
  select coalesce(sum(b.n),0) into before_p2 from public.mon_filter_parity_barrier() b
   where b.check_name='genuine_monthly_leaked_into_annual';

  -- 1. mon_af_new_listing_readiness — 4 occurrences (check A, check B loop, check B dynamic SQL,
  --    check C loop). All four are the same "is this row in the cohort" test.
  select pg_get_functiondef(oid) into src from pg_proc
   where proname='mon_af_new_listing_readiness' and pronamespace='public'::regnamespace;
  occ := (length(src) - length(replace(src, needle, ''))) / length(needle);
  if occ <> 4 then raise exception 'ABORT: readiness needle occurs %, expected 4', occ; end if;
  execute replace(src, needle, repl);

  -- 2. mon_rich_attrs_barrier — 1 occurrence (spaced variant)
  select pg_get_functiondef(oid) into src from pg_proc
   where proname='mon_rich_attrs_barrier' and pronamespace='public'::regnamespace;
  occ := (length(src) - length(replace(src, needle2, ''))) / length(needle2);
  if occ <> 1 then raise exception 'ABORT: rich_attrs needle occurs %, expected 1', occ; end if;
  execute replace(src, needle2, repl);

  -- 3. mon_filter_parity_barrier check (2) — probe driven from the registry. The rent-period
  --    SEMANTICS (سنوي accepts سنوي or RNPL-شهري) are period-specific, so this check iterates every
  --    registered ANNUAL-RENT type; a Buy or Monthly cohort needs its own check, not this one.
  select pg_get_functiondef(oid) into src from pg_proc
   where proname='mon_filter_parity_barrier' and pronamespace='public'::regnamespace;
  occ := (length(src) - length(replace(src, p2_old, ''))) / length(p2_old);
  if occ <> 1 then raise exception 'ABORT: parity check-2 block occurs %, expected 1', occ; end if;
  execute replace(src, p2_old, p2_new);

  -- ROLLOUT EQUALITY (state restored first, so this is apples-to-apples)
  update public.mon_rich_attrs_drift_state set drift_n = st_n, drift_wasalt = st_w where id = 1;
  select public.mon_rich_attrs_barrier() into after_rich;
  update public.mon_rich_attrs_drift_state set drift_n = st_n, drift_wasalt = st_w where id = 1;
  select public.mon_af_new_listing_readiness() into after_ready;
  select coalesce(sum(b.n),0) into after_p2 from public.mon_filter_parity_barrier() b
   where b.check_name='genuine_monthly_leaked_into_annual';

  if (before_rich, before_ready, before_p2) is distinct from (after_rich, after_ready, after_p2) then
    raise exception 'ABORT: verdict changed rich %->%, ready %->%, parity2 %->%',
      before_rich, after_rich, before_ready, after_ready, before_p2, after_p2;
  end if;

  if exists (select 1 from pg_proc
              where proname in ('mon_af_new_listing_readiness','mon_rich_attrs_barrier')
                and pronamespace='public'::regnamespace
                and pg_get_functiondef(oid) like '%'||needle||'%') then
    raise exception 'ABORT: a hardcoded cohort predicate survived';
  end if;

  -- leave the stateful counters exactly as we found them
  update public.mon_rich_attrs_drift_state set drift_n = st_n, drift_wasalt = st_w where id = 1;

  raise notice 'SUCCESS: 3 barriers registry-driven; verdicts unchanged (rich=%, ready=%, parity2=%)',
    after_rich, after_ready, after_p2;
end $do$;