-- A PLATFORM'S PAGE GRANULARITY IS A RECORDED FACT, NOT AN ALARM THAT NEVER CLOSES (🔧 2026-11-03, owner 2026-10-23:
-- «every open alarm must be WORTH a slot»). mon_detect_card_link_identity() raises P3 «granularity» when a platform's
-- source page is coarser than a listing (a project page listing many units — rakez 99.4 %, wahadat 98.9 %, expattrusted
-- 96.0 %, rightcompound 95.7 %, compoundin 95.1 %, nufouth_commercial 54.1 %, alsaedan 43.3 %, manafe 27.4 %) and
-- «granularity_unproven» when a young table (alajlan, hasaad, azure, rawaf, razre: 10–32 rows) looks the same. Its own
-- text calls both «a source-granularity fact, not a defect» and says the one thing worth watching is a platform that
-- APPEARS here having published one URL per listing before. Thirteen such rows have sat open since September with
-- nothing to do. From now on the fact lives in ops_card_link_granularity (first seen, last seen, share): a platform is
-- raised at P3 for its first 7 days on the ledger — the heads-up — and resolved by the same path afterwards, while the
-- ledger keeps the share so a later collapse of per-listing URLs onto shared pages reads as a share that moved. The P2
-- duplicate verdict (rows sharing a URL AND an ad_number) is untouched and stays armed at every table size.
create table if not exists public.ops_card_link_granularity (
  source_table    text primary key,
  collision_share numeric,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);
comment on table public.ops_card_link_granularity is
  'Platforms whose source page is coarser than a listing (mon_detect_card_link_identity granularity / granularity_unproven): a recorded fact. P3 for the first 7 days on the ledger, then resolved by the same detector path; the share is kept so a collapse of per-listing URLs onto shared pages shows as movement (🔧 2026-11-03).';

create or replace function public.card_link_granularity_note(p_table text, p_key text, p_detail jsonb)
returns integer
language plpgsql
set search_path = public
as $function$
declare v_first timestamptz;
begin
  insert into public.ops_card_link_granularity (source_table, collision_share, first_seen_at, last_seen_at)
  values (p_table, (p_detail->>'collision_share')::numeric, now(), now())
  on conflict (source_table) do update
    set collision_share = excluded.collision_share, last_seen_at = now()
  returning first_seen_at into v_first;
  if v_first >= now() - interval '7 days' then
    return public.mon_raise('P3', 'card_link_identity', p_table, p_key,
      p_detail || jsonb_build_object('ledger', 'ops_card_link_granularity', 'first_seen_at', v_first,
                                     'resolves', 'by this same path once the platform has been on the ledger 7 days'));
  end if;
  perform public.mon_resolve_key('card_link_identity', p_key);
  return 0;
end
$function$;

-- The ledger starts from the alerts already open, dated by their first raise (September–October), so the thirteen
-- standing rows resolve on the next evaluation instead of paging for seven more days.
insert into public.ops_card_link_granularity (source_table, collision_share, first_seen_at, last_seen_at)
select a.platform, (a.detail->>'collision_share')::numeric, a.created_at, now()
  from public.alert_event a
 where a.kind = 'card_link_identity' and a.resolved_at is null
   and (a.dedup_key like 'card_link_identity:granularity:%' or a.dedup_key like 'card_link_identity:granularity_unproven:%')
on conflict (source_table) do nothing;

do $mig$
declare
  d text := pg_get_functiondef('public.mon_detect_card_link_identity()'::regprocedure);
  old1 constant text := $o$      n := n + public.mon_raise(
        'P3', 'card_link_identity', t, 'card_link_identity:granularity:' || t,
$o$;
  new1 constant text := $n$      n := n + public.card_link_granularity_note(t, 'card_link_identity:granularity:' || t,
$n$;
  old2 constant text := $o$      n := n + public.mon_raise(
        'P3', 'card_link_identity', t, 'card_link_identity:granularity_unproven:' || t,
$o$;
  new2 constant text := $n$      n := n + public.card_link_granularity_note(t, 'card_link_identity:granularity_unproven:' || t,
$n$;
begin
  if position(old1 in d) = 0 or position(old2 in d) = 0 then
    raise exception 'mon_detect_card_link_identity: the two P3 granularity raises were not found — read the live function first';
  end if;
  execute replace(replace(d, old1, new1), old2, new2);
  d := pg_get_functiondef('public.mon_detect_card_link_identity()'::regprocedure);
  if position('card_link_granularity_note(t, ''card_link_identity:granularity:''' in d) = 0
     or position('card_link_granularity_note(t, ''card_link_identity:granularity_unproven:''' in d) = 0
     or position($p$'P3', 'card_link_identity'$p$ in d) > 0 then
    raise exception 'mon_detect_card_link_identity: the ledger path did not land';
  end if;
end
$mig$;

-- Proof at apply time, through the same path the detector now takes: every open granularity row older than 7 days
-- on the ledger resolves; a platform first seen today would still raise.
do $proof$
declare r record; n int := 0; v int;
begin
  for r in select a.platform, a.dedup_key, a.detail from public.alert_event a
            where a.kind = 'card_link_identity' and a.resolved_at is null
              and (a.dedup_key like 'card_link_identity:granularity:%' or a.dedup_key like 'card_link_identity:granularity_unproven:%')
  loop
    n := n + public.card_link_granularity_note(r.platform, r.dedup_key, r.detail);
  end loop;
  if n <> 0 then raise exception 'PROOF A FAILED: % standing granularity rows re-raised although older than 7 days on the ledger', n; end if;
  v := public.card_link_granularity_note('__proof_new_table__', 'card_link_identity:granularity:__proof_new_table__',
         jsonb_build_object('collision_share', 0.99, 'why', 'proof row'));
  if v <> 1 then raise exception 'PROOF B FAILED: a platform first seen today did not raise (%)', v; end if;
  perform public.mon_resolve_key('card_link_identity', 'card_link_identity:granularity:__proof_new_table__');
end
$proof$;
