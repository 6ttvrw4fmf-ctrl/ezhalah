-- ADJUDICATED ROWS STAY HIDDEN THROUGH THE CRAWL UPSERT, NOT ONLY THROUGH THE RECOVERY JOB
-- (lane: dealapp + adjudication, 2026-11-09; alert_event 13940 adjudicated_reactivation).
--
-- WHAT WAS MEASURED. Four rows in ops_adjudicated_listing were ACTIVE again on 2026-11-09:
--   dealapp_residential_listings 22045812 — retracted 2026-11-04 (wrong-table sibling: the source
--     says «استخدامات العقار: تجاري»; re-read live in a real browser 2026-11-09 ~12:35 UTC, still
--     says it, «إيجار يومي 60,000») — re-seen by the nightly crawl at 01:22 UTC and upserted
--     active=true, missing_count=0. The decision stands: re-hidden below.
--   gathern_residential_listings 13971129, 25436999, 25446442 — retracted 2026-11-02 / 11-08 on
--     own-page 404s with live controls — re-listed by the gathern feed at 04:1x UTC and upserted
--     active=true by the crawl (scrapers/gathern/liveness.py:34 names exactly this path). Re-read in
--     a real browser 2026-11-09 ~12:40 UTC: all three OWN pages are live, full unit pages (unit
--     numbers 711825, 603408, 440700; الخرج - حي البرج 80 m², المزاحمية - حي الخرارة 2000 m²,
--     الرياض - حي لبن 30 m²). The source published them after the adjudication: they go into
--     ops_adjudication_superseded (20261103111241) and stay ACTIVE — the honest flip.
-- auto_recover_false_inactive() was innocent: it carries the ops_adjudicated_listing exemption
-- (20260830193119). The path with NO exemption is the scraper upsert itself — every platform's
-- upsert payload writes active=true, and a feed listing an ad is a CANDIDATE signal, never a
-- verdict (docs/ops/LISTING_LIVENESS.md). The recorded decision was overwritten by the weaker
-- signal, nightly, for as long as the feed kept the id.
--
-- THE RULE. A row the adjudication ledger has retracted cannot flip active=false → true by ANY
-- writer unless ops_adjudication_superseded records that its OWN page was read live after the
-- adjudication. Enforced where every writer passes: a BEFORE UPDATE trigger on every
-- *_residential_listings / *_commercial_listings table. It fires only on the false→true flip (WHEN
-- clause), so the hot path — ordinary upserts of active rows — pays nothing. It never deactivates
-- anything: a row that is active stays active; only the flip back is refused. The refused flip is
-- logged so the detector can tell "the guard held" from "nothing tried".
--
-- The dealapp sibling the 11-04 decision named as the live copy (dealapp_commercial_listings
-- 22738059, retired 2026-11-08 by the crawl's cross-table supersession) is NOT restored here: the
-- crawl files this ad residential because the usage chip is not parsed off this page shape, and
-- would retire the commercial copy again tonight. That routing is a separate dealapp finding.

create table if not exists public.ops_adjudicated_reactivation_blocked (
  id            bigserial primary key,
  source_table  text        not null,
  listing_id    bigint      not null,
  blocked_at    timestamptz not null default now(),
  by_role       text        not null default current_user,
  ledger        text
);
create index if not exists ops_adjudicated_reactivation_blocked_row_idx
  on public.ops_adjudicated_reactivation_blocked (source_table, listing_id, blocked_at desc);
alter table public.ops_adjudicated_reactivation_blocked enable row level security;
comment on table public.ops_adjudicated_reactivation_blocked is
  'Every false→true flip of active that tg_keep_adjudicated_hidden() refused because the row is in '
  'ops_adjudicated_listing and not in ops_adjudication_superseded. Evidence that the guard held; '
  'never read as a verdict about the listing.';

create or replace function public.tg_keep_adjudicated_hidden()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_ledger text;
begin
  -- Only reached on a false→true flip (trigger WHEN). Read the ONE union view, never a single
  -- ledger (verify-adjudication-is-never-undone.ts: a consumer that reaches past the view silently
  -- stops covering the next ledger).
  select j.ledger into v_ledger
    from public.ops_adjudicated_listing j
   where j.tbl = TG_TABLE_NAME and j.listing_id = new.id
   limit 1;
  if v_ledger is null then
    return new;
  end if;
  if exists (select 1 from public.ops_adjudication_superseded s
              where s.source_table = TG_TABLE_NAME and s.listing_id = new.id) then
    return new;                      -- the source republished it on its own page: the flip is honest
  end if;
  new.active := false;               -- keep the decision; everything else the writer sent lands
  insert into public.ops_adjudicated_reactivation_blocked (source_table, listing_id, ledger)
  values (TG_TABLE_NAME, new.id, v_ledger);
  return new;
end
$$;

comment on function public.tg_keep_adjudicated_hidden() is
  'BEFORE UPDATE guard: an adjudicated (retracted) listing cannot be flipped active=false→true by '
  'any writer — scraper upsert, recovery job, hand edit — unless ops_adjudication_superseded '
  'records its own page read live after the adjudication. Refusals are logged to '
  'ops_adjudicated_reactivation_blocked. It never deactivates a row that is already active.';

-- Attach to every listing table that exists today. A table created later is caught by
-- mon_detect_adjudication_guard_missing() below, which re-measures from pg_trigger every sweep.
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
     where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
  loop
    execute format('drop trigger if exists trg_keep_adjudicated_hidden on public.%I', t);
    execute format(
      'create trigger trg_keep_adjudicated_hidden before update on public.%I '
      'for each row when (old.active is not true and new.active is true) '
      'execute function public.tg_keep_adjudicated_hidden()', t);
  end loop;
end $$;

-- A listing table without the guard is a table whose adjudications the crawl can undo.
create or replace function public.mon_adjudication_guard_missing()
returns text[]
language sql
stable
set search_path to 'public'
as $$
  select coalesce(array_agg(t.tablename order by t.tablename), '{}')
    from pg_tables t
   where t.schemaname = 'public'
     and t.tablename ~ '_(residential|commercial)_listings$'
     and not exists (select 1 from pg_trigger tg
                       join pg_class c on c.oid = tg.tgrelid
                       join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname = t.tablename
                        and tg.tgname = 'trg_keep_adjudicated_hidden' and not tg.tgisinternal
                        and tg.tgenabled <> 'D');
$$;

create or replace function public.mon_detect_adjudication_guard_missing()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare n int := 0; missing text[];
begin
  missing := public.mon_adjudication_guard_missing();
  if cardinality(missing) > 0 then
    n := public.mon_raise('P1', 'adjudication_guard_missing', 'all',
      'adjudication_guard_missing',
      jsonb_build_object('tables', to_jsonb(missing),
        'why', 'these listing tables have no (enabled) trg_keep_adjudicated_hidden trigger, so a '
            || 'crawl upsert can flip an adjudicated retraction back to active=true and serve it '
            || 'again — the path that reactivated 4 adjudicated rows on 2026-11-09.',
        'fix', 'create trigger trg_keep_adjudicated_hidden before update on <table> for each row '
            || 'when (old.active is not true and new.active is true) execute function '
            || 'public.tg_keep_adjudicated_hidden(); never drop the trigger to clear this.'));
  else
    perform public.mon_resolve('adjudication_guard_missing', 'all');
  end if;
  return n;
end $$;

-- Roster entry in the SAME migration (AGENTS.md: a detector outside the roster is decoration).
do $$
declare src text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  if position('mon_detect_adjudication_guard_missing' in src) = 0 then
    src := replace(src,
      $q$'mon_detect_run_duration_explosion',$q$,
      $q$'mon_detect_run_duration_explosion',
    'mon_detect_adjudication_guard_missing',$q$);
    if position('mon_detect_adjudication_guard_missing' in src) = 0 then
      raise exception 'could not splice mon_detect_adjudication_guard_missing into mon_run_all_detectors';
    end if;
    execute src;
  end if;
end $$;

-- THE THREE GATHERN UNITS: own page read live after the adjudication → superseded, stay active.
insert into public.ops_adjudication_superseded (source_table, listing_id, superseded_at, evidence)
values
  ('gathern_residential_listings', 13971129, now(), jsonb_build_object(
     'why', 'own page read LIVE 2026-11-09 ~12:40 UTC in a real browser after the 11-02 bare-404 retraction '
         || '(https://gathern.co/view/152579/unit/272442: full unit page, unit 711825, الخرج - حي البرج, 80 m², 112 reviews)',
     'task', 'dealapp-adjudication-lane-2026-11-09', 'reactivated_by', 'gathern crawl upsert 2026-11-09 04:11 UTC')),
  ('gathern_residential_listings', 25436999, now(), jsonb_build_object(
     'why', 'own page read LIVE 2026-11-09 ~12:40 UTC in a real browser after the 11-08 404x3 retraction '
         || '(https://gathern.co/view/202329/unit/282823: full unit page, unit 603408, المزاحمية - حي الخرارة, 2000 m²)',
     'task', 'dealapp-adjudication-lane-2026-11-09', 'reactivated_by', 'gathern crawl upsert 2026-11-09 04:18 UTC')),
  ('gathern_residential_listings', 25446442, now(), jsonb_build_object(
     'why', 'own page read LIVE 2026-11-09 ~12:40 UTC in a real browser after the 11-08 404x3 retraction '
         || '(https://gathern.co/view/202584/unit/283181: full unit page, unit 440700, الرياض - حي لبن, 30 m²)',
     'task', 'dealapp-adjudication-lane-2026-11-09', 'reactivated_by', 'gathern crawl upsert 2026-11-09 04:20 UTC'))
on conflict do nothing;

-- THE DEALAPP ROW: the decision stands → re-hidden, with this session's evidence on the ledger.
update public.dealapp_residential_listings
   set active = false
 where id = 22045812 and active;

update public.ops_adjudicated_retraction r
   set evidence = coalesce(r.evidence, '{}'::jsonb) || jsonb_build_object(
         'rehidden_2026_11_09', jsonb_build_object(
           'reactivated_by', 'dealapp crawl upsert 2026-11-09 01:22 UTC (active=true, missing_count=0)',
           'reread', 'real browser 2026-11-09 ~12:35 UTC: page live, «استخدامات العقار: تجاري», «إيجار يومي 60,000» — decision stands',
           'guard', 'trg_keep_adjudicated_hidden (this migration)'))
 where r.source_table = 'dealapp_residential_listings' and r.listing_id = 22045812;

-- APPLY-TIME SELF-TEST, executed against the live objects (never a text match):
--   1. every listing table carries the guard;
--   2. the guard refuses a false→true flip on an adjudicated row and logs it;
--   3. a superseded adjudication is honoured (the three gathern rows above are the live case);
--   4. a NON-adjudicated row still flips (the guard never widens into a kill switch).
do $$
declare
  missing text[];
  v_active boolean;
  v_log int;
  v_id bigint := 22045812;              -- adjudicated, hidden above
begin
  missing := public.mon_adjudication_guard_missing();
  if cardinality(missing) > 0 then
    raise exception 'guard missing on %', missing;
  end if;

  -- 2. adjudicated row: the flip is refused and logged
  select count(*) into v_log from public.ops_adjudicated_reactivation_blocked
   where source_table = 'dealapp_residential_listings' and listing_id = v_id;
  update public.dealapp_residential_listings set active = true where id = v_id;
  select active into v_active from public.dealapp_residential_listings where id = v_id;
  if v_active then raise exception 'self-test: adjudicated dealapp % flipped active', v_id; end if;
  if (select count(*) from public.ops_adjudicated_reactivation_blocked
       where source_table = 'dealapp_residential_listings' and listing_id = v_id) <> v_log + 1 then
    raise exception 'self-test: refused flip was not logged';
  end if;

  -- 3. superseded adjudication: the flip goes through (probe on the real superseded gathern row)
  update public.gathern_residential_listings set active = false where id = 13971129;
  update public.gathern_residential_listings set active = true  where id = 13971129;
  select active into v_active from public.gathern_residential_listings where id = 13971129;
  if not v_active then raise exception 'self-test: superseded adjudication was still refused'; end if;

  -- 4. a non-adjudicated inactive row (any) can still flip — probe and restore
  select d.id into v_id from public.dealapp_residential_listings d
   where not d.active
     and not exists (select 1 from public.ops_adjudicated_listing j
                      where j.tbl = 'dealapp_residential_listings' and j.listing_id = d.id)
   limit 1;
  if v_id is not null then
    update public.dealapp_residential_listings set active = true where id = v_id;
    select active into v_active from public.dealapp_residential_listings where id = v_id;
    update public.dealapp_residential_listings set active = false where id = v_id;   -- restore
    if not v_active then raise exception 'self-test: guard refused a NON-adjudicated row %', v_id; end if;
  end if;
end $$;
