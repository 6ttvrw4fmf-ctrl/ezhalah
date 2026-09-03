-- Ezhalah must know its own liveness state without being asked.
--
-- Owner, 2026-08-30: "I want to reach the point where I don't need to ask Claude: 'Do we have dead
-- listings?' Ezhalah itself should continuously know: how many are verified alive, how many are
-- stale, how many are unknown, how many were confirmed dead, and whether any platform's
-- verification system is becoming unhealthy."
--
-- 20260830183939 gave every listing table last_verified_alive_at, deliberately all-NULL: "seen by
-- the crawler" and "positively verified alive" became structurally separate. That column is only
-- useful if something reads it continuously. This is that something.
--
-- WHAT IS HERE
--   ops_liveness_registry             the SQL half of scrapers/common/liveness_policies.py -- which
--                                     platforms are production-searchable, their strategy tier and
--                                     their verification SLA. Pinned to the Python registry by
--                                     scripts/verify-liveness-registry-mirror.ts (offline, in npm
--                                     test), so the two cannot drift.
--   ops_liveness_coverage_snapshot    an hourly per-table census. A snapshot, not a live scan: the
--                                     detector sweep runs every 30 minutes under a soft deadline
--                                     and must not seq-scan 68 listing tables to answer a question
--                                     whose answer changes hourly at most.
--   ops_platform_liveness_coverage    THE DASHBOARD. One row per production-searchable platform:
--                                     active / verified in SLA / verified ever / never verified /
--                                     under strike, with percentages and the strategy tier.
--   mon_detect_liveness_coverage_ramp TEMPORARY (expires 2026-10-15). Owner: "add a temporary
--                                     coverage-ramp monitor during this transition so we can see
--                                     whether verification coverage is actually increasing. I
--                                     don't want the permanent monitor delayed and then
--                                     forgotten." It does NOT alert on low coverage -- on day one
--                                     coverage is 0% everywhere by construction and 29 alerts
--                                     saying so would be noise. It alerts when coverage STOPS
--                                     INCREASING while still short of target.
--   mon_detect_liveness_verification_sla
--                                     PERMANENT, dormant until 2026-09-13. Once verification has
--                                     had two weeks to populate, a tier-1/tier-2 platform whose
--                                     in-SLA verified share sits below the floor is a platform
--                                     whose verification system is unhealthy, and that is exactly
--                                     what the owner asked to be told without asking.
--
-- NOTHING HERE EVER DEACTIVATES A ROW. These are monitoring thresholds. Deactivation happens only
-- through scrapers/common/liveness_contract.decide(), on DIRECT evidence, at full grace.

-- ---------------------------------------------------------------------------------------------
-- 1. THE REGISTRY (mirror of scrapers/common/liveness_policies.py)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.ops_liveness_registry (
  platform    text primary key,
  strategy    text not null check (strategy in
                ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT','CRAWL_PRESENCE_ONLY')),
  sla_hours   int  not null check (sla_hours > 0),
  grace       int  not null check (grace > 0),
  updated_at  timestamptz not null default now()
);
comment on table public.ops_liveness_registry is
  'SQL mirror of scrapers/common/liveness_policies.py. Pinned by '
  'scripts/verify-liveness-registry-mirror.ts -- edit the Python registry and regenerate '
  'sql/mirrors/liveness_registry.json, never this table by hand.';

insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace) values
  ('abeea','CRAWL_PRESENCE_ONLY',168,3),
  ('abralosol','CRAWL_PRESENCE_ONLY',168,3),
  ('aldarim','CRAWL_PRESENCE_ONLY',168,3),
  ('alhoshan','CRAWL_PRESENCE_ONLY',168,3),
  ('alkhaas','CRAWL_PRESENCE_ONLY',168,3),
  ('aouj','CRAWL_PRESENCE_ONLY',168,3),
  ('aqar','DIRECT_REVISIT',48,3),
  ('aqaratikom','CRAWL_PRESENCE_ONLY',168,3),
  ('aqarcity','CRAWL_PRESENCE_ONLY',168,3),
  ('aqargate','CRAWL_PRESENCE_ONLY',168,3),
  ('aqarmonthly','CRAWL_PRESENCE_ONLY',168,3),
  ('arkaan','CRAWL_PRESENCE_ONLY',168,3),
  ('dealapp','CANDIDATE_PLUS_DIRECT',96,3),
  ('eaqartabuk','CRAWL_PRESENCE_ONLY',168,3),
  ('eastabha','CRAWL_PRESENCE_ONLY',168,3),
  ('erapulse','CRAWL_PRESENCE_ONLY',168,3),
  ('fursaghyr','CRAWL_PRESENCE_ONLY',168,3),
  ('gathern','DIRECT_REVISIT',96,3),
  ('hajer','CRAWL_PRESENCE_ONLY',168,3),
  ('jazwtn','CRAWL_PRESENCE_ONLY',168,3),
  ('jurash','CRAWL_PRESENCE_ONLY',168,3),
  ('mizlaj','CRAWL_PRESENCE_ONLY',168,3),
  ('mustqr','CRAWL_PRESENCE_ONLY',168,3),
  ('nowaisiry','CRAWL_PRESENCE_ONLY',168,3),
  ('october','CRAWL_PRESENCE_ONLY',168,3),
  ('raghdan','CRAWL_PRESENCE_ONLY',168,3),
  ('ramzalqasim','CRAWL_PRESENCE_ONLY',168,3),
  ('rawasidark','CRAWL_PRESENCE_ONLY',168,3),
  ('sadin','CRAWL_PRESENCE_ONLY',168,3),
  ('sanadak','CRAWL_PRESENCE_ONLY',168,3),
  ('satel','CRAWL_PRESENCE_ONLY',168,3),
  ('souq24','CRAWL_PRESENCE_ONLY',168,3),
  ('therc','CRAWL_PRESENCE_ONLY',168,3),
  ('wasalt','DIRECT_REVISIT',96,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours,
      grace = excluded.grace, updated_at = now();

-- A platform that leaves the Python registry must leave this table too, or the dashboard keeps
-- reporting on inventory nobody verifies any more.
delete from public.ops_liveness_registry
 where platform not in ('abeea','abralosol','aldarim','alhoshan','alkhaas','aouj','aqar','aqaratikom','aqarcity','aqargate','aqarmonthly','arkaan','dealapp','eaqartabuk','eastabha','erapulse','fursaghyr','gathern','hajer','jazwtn','jurash','mizlaj','mustqr','nowaisiry','october','raghdan','ramzalqasim','rawasidark','sadin','sanadak','satel','souq24','therc','wasalt');

-- ---------------------------------------------------------------------------------------------
-- 2. THE HOURLY CENSUS
-- ---------------------------------------------------------------------------------------------
create table if not exists public.ops_liveness_coverage_snapshot (
  taken_at         timestamptz not null default now(),
  platform         text not null,
  tbl              text not null,
  active_rows      int  not null,
  verified_in_sla  int  not null,   -- last_verified_alive_at within the platform's SLA window
  verified_ever    int  not null,   -- proven alive at least once, however long ago
  never_verified   int  not null,   -- active, and nothing has ever proven it alive
  under_strike     int  not null,   -- missing_count > 0: on its way to a confirmed death
  primary key (taken_at, tbl)
);
create index if not exists ops_liveness_coverage_snapshot_platform_idx
  on public.ops_liveness_coverage_snapshot (platform, taken_at desc);
comment on table public.ops_liveness_coverage_snapshot is
  'Hourly per-table liveness census. Written by ops_liveness_snapshot_refresh(); read by the '
  'dashboard view and both liveness detectors so the 30-minute detector sweep never has to '
  'seq-scan 68 listing tables under its soft deadline.';

create or replace function public.ops_liveness_snapshot_refresh()
returns int
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  r record; n int := 0; v_now timestamptz := now(); v_sql text;
  v_active int; v_sla int; v_ever int; v_never int; v_strike int;
begin
  for r in
    select g.platform, g.sla_hours, t.table_name as tbl
      from public.ops_liveness_registry g
      join information_schema.tables t
        on t.table_schema = 'public'
       and t.table_name in (g.platform || '_residential_listings',
                            g.platform || '_commercial_listings')
     order by g.platform, t.table_name
  loop
    -- Every listing table carries both columns (20260830183939 proved 67/67 coverage and
    -- scripts/verify-listing-tables-carry-verification-column.ts keeps it that way), so this
    -- needs no per-table column guard -- and it stays fail-loud rather than skipping a table.
    v_sql := format($q$
      select count(*) filter (where active),
             count(*) filter (where active and last_verified_alive_at > %L::timestamptz),
             count(*) filter (where active and last_verified_alive_at is not null),
             count(*) filter (where active and last_verified_alive_at is null),
             count(*) filter (where active and coalesce(missing_count,0) > 0)
        from public.%I $q$, v_now - make_interval(hours => r.sla_hours), r.tbl);
    execute v_sql into v_active, v_sla, v_ever, v_never, v_strike;

    insert into public.ops_liveness_coverage_snapshot
      (taken_at, platform, tbl, active_rows, verified_in_sla, verified_ever,
       never_verified, under_strike)
    values (v_now, r.platform, r.tbl, v_active, v_sla, v_ever, v_never, v_strike)
    on conflict (taken_at, tbl) do nothing;
    n := n + 1;
  end loop;

  delete from public.ops_liveness_coverage_snapshot where taken_at < now() - interval '90 days';
  return n;
end $fn$;

-- ---------------------------------------------------------------------------------------------
-- 3. THE DASHBOARD
-- ---------------------------------------------------------------------------------------------
create or replace view public.ops_platform_liveness_coverage as
with latest as (
  select distinct on (platform) platform, taken_at
    from public.ops_liveness_coverage_snapshot
   order by platform, taken_at desc
),
agg as (
  select s.platform,
         max(s.taken_at)             as as_of,
         sum(s.active_rows)::int     as active,
         sum(s.verified_in_sla)::int as verified_in_sla,
         sum(s.verified_ever)::int   as verified_ever,
         sum(s.never_verified)::int  as never_verified,
         sum(s.under_strike)::int    as under_strike
    from public.ops_liveness_coverage_snapshot s
    join latest l on l.platform = s.platform and l.taken_at = s.taken_at
   group by s.platform
)
select g.platform,
       g.strategy,
       g.sla_hours,
       coalesce(a.active, 0)          as active,
       coalesce(a.verified_in_sla, 0) as verified_in_sla,
       coalesce(a.verified_ever, 0)   as verified_ever,
       coalesce(a.never_verified, 0)  as never_verified,
       coalesce(a.under_strike, 0)    as under_strike,
       case when coalesce(a.active,0) = 0 then null
            else round(100.0 * a.verified_in_sla / a.active, 1) end as pct_verified_in_sla,
       case when coalesce(a.active,0) = 0 then null
            else round(100.0 * a.never_verified / a.active, 1) end as pct_never_verified,
       a.as_of
  from public.ops_liveness_registry g
  left join agg a on a.platform = g.platform
 order by (g.strategy = 'CRAWL_PRESENCE_ONLY'), coalesce(a.active,0) desc;

comment on view public.ops_platform_liveness_coverage is
  'One row per production-searchable platform: how much of its live inventory Ezhalah has '
  'positively proven alive inside that platform SLA. CRAWL_PRESENCE_ONLY platforms are expected '
  'to read 0% verified -- that tier is a recorded known gap, not an approved design.';

-- ---------------------------------------------------------------------------------------------
-- 4. THE TEMPORARY RAMP MONITOR (expires 2026-10-15)
-- ---------------------------------------------------------------------------------------------
create or replace function public.mon_detect_liveness_coverage_ramp()
returns int
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_expires date := date '2026-10-15';
  v_target  numeric := 80.0;   -- coverage at which a platform is no longer "ramping"
  v_raised  int := 0;
  v_latest  timestamptz;
  r record;
begin
  -- A census that stopped is not coverage news, it is a blind monitor -- the exact shape that read
  -- as a clean bill of health on 2026-08-10. Check the feed before trusting anything it says.
  select max(taken_at) into v_latest from public.ops_liveness_coverage_snapshot;
  if v_latest is null or v_latest < now() - interval '6 hours' then
    perform public.mon_raise('P2', 'liveness_snapshot_stale', 'monitoring',
      'liveness_snapshot_stale',
      jsonb_build_object('latest_snapshot', v_latest,
        'why', 'ops_liveness_snapshot_refresh() has not produced a census in over 6 hours, so '
            || 'every liveness coverage number on the dashboard is stale. Check cron job '
            || 'liveness-coverage-snapshot.'));
    return 1;
  end if;
  perform public.mon_resolve_key('liveness_snapshot_stale', 'liveness_snapshot_stale');

  if current_date > v_expires then
    -- Deliberately self-retiring -- the permanent SLA monitor below is what carries on. Retiring
    -- must CLEAR what this monitor raised, per platform: a temporary detector that stops running
    -- while its alerts stay open is a ratchet, and mon_detect_unresolvable_alert_kinds would be
    -- right to say nothing can ever clear them.
    perform public.mon_resolve_key('liveness_coverage_ramp', 'ramp:' || g.platform)
       from public.ops_liveness_registry g;
    perform public.mon_resolve_key('liveness_coverage_ramp', 'ramp_expired');
    return 0;
  end if;

  for r in
    select c.platform, c.active, c.verified_in_sla, c.pct_verified_in_sla,
           (select sum(s.verified_in_sla)
              from public.ops_liveness_coverage_snapshot s
             where s.platform = c.platform
               and s.taken_at = (select max(s2.taken_at)
                                   from public.ops_liveness_coverage_snapshot s2
                                  where s2.platform = c.platform
                                    and s2.taken_at < now() - interval '48 hours')) as verified_48h_ago
      from public.ops_platform_liveness_coverage c
     where c.strategy in ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT')
       and c.active > 0
  loop
    -- No 48h-old baseline yet => the ramp has not had time to be measured. Say nothing.
    if r.verified_48h_ago is null then
      continue;
    end if;

    if coalesce(r.pct_verified_in_sla, 0) >= v_target then
      perform public.mon_resolve_key('liveness_coverage_ramp', 'ramp:' || r.platform);
      continue;
    end if;

    if r.verified_in_sla <= r.verified_48h_ago then
      perform public.mon_raise('P2', 'liveness_coverage_ramp', r.platform,
        'ramp:' || r.platform,
        jsonb_build_object(
          'platform', r.platform,
          'active', r.active,
          'verified_in_sla_now', r.verified_in_sla,
          'verified_in_sla_48h_ago', r.verified_48h_ago,
          'pct_verified_in_sla', r.pct_verified_in_sla,
          'target_pct', v_target,
          'monitor_expires', v_expires,
          'why', 'verification coverage on this platform is NOT increasing while still short of '
              || 'target. Either its liveness job is not running, or it is running and writing '
              || 'nothing -- a quarantined run, a blocked proxy, or a cohort it can never reach. '
              || 'This is a TEMPORARY transition monitor; it retires ' || v_expires || '.',
          'action', 'select * from ops_platform_liveness_coverage; then check that platform '
              || 'liveness workflow last run.'));
      v_raised := v_raised + 1;
    else
      perform public.mon_resolve_key('liveness_coverage_ramp', 'ramp:' || r.platform);
    end if;
  end loop;

  return v_raised;
end $fn$;

-- ---------------------------------------------------------------------------------------------
-- 5. THE PERMANENT SLA MONITOR (dormant until 2026-09-13)
-- ---------------------------------------------------------------------------------------------
create or replace function public.mon_detect_liveness_verification_sla()
returns int
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  -- A grace DATE, not a grace period counted from "now": a fixed date cannot be reset by a
  -- redeploy, and it is visible in the function body rather than buried in a config row.
  v_active_from date := date '2026-09-13';
  v_floor numeric := 50.0;
  v_raised int := 0;
  r record;
begin
  if current_date < v_active_from then
    return 0;   -- verification is still populating; alerting now would only produce noise
  end if;

  for r in
    select platform, strategy, active, verified_in_sla, never_verified, pct_verified_in_sla
      from public.ops_platform_liveness_coverage
     where strategy in ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT')
       and active > 0
  loop
    if coalesce(r.pct_verified_in_sla, 0) < v_floor then
      perform public.mon_raise('P1', 'liveness_verification_sla', r.platform,
        'liveness_sla:' || r.platform,
        jsonb_build_object(
          'platform', r.platform,
          'strategy', r.strategy,
          'active', r.active,
          'verified_in_sla', r.verified_in_sla,
          'never_verified', r.never_verified,
          'pct_verified_in_sla', r.pct_verified_in_sla,
          'floor_pct', v_floor,
          'why', 'active=true is supposed to mean we have recent affirmative evidence this '
              || 'listing is live. On this platform most active rows carry no such evidence '
              || 'inside its own SLA window, so its VERIFICATION SYSTEM is unhealthy -- this is '
              || 'not a statement about its inventory. Do NOT deactivate anything in response: '
              || 'absence of verification is UNKNOWN, never death (owner rule 2026-08-30).',
          'action', 'find why that platform liveness job is not covering its population: not '
              || 'scheduled, quarantined by a trust gate, blocked proxy, or a probe rate too low '
              || 'for the population size.'));
      v_raised := v_raised + 1;
    else
      perform public.mon_resolve_key('liveness_verification_sla', 'liveness_sla:' || r.platform);
    end if;
  end loop;

  return v_raised;
end $fn$;

-- ---------------------------------------------------------------------------------------------
-- 6. ROSTER + SCHEDULE -- a detector nothing calls is decoration (AGENTS.md)
-- ---------------------------------------------------------------------------------------------
do $roster$
declare src text; new_src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src is null then
    raise exception 'mon_run_all_detectors() not found - cannot register the liveness detectors';
  end if;
  if position('mon_detect_liveness_coverage_ramp' in src) > 0 then
    return;   -- already registered (idempotent re-apply)
  end if;
  new_src := replace(src,
    '''mon_detect_photo_sync_stale''',
    '''mon_detect_photo_sync_stale'', ''mon_detect_liveness_coverage_ramp'', '
    || '''mon_detect_liveness_verification_sla''');
  if new_src = src then
    raise exception 'roster anchor not found in mon_run_all_detectors() - refusing to leave the '
                    'liveness detectors unreachable';
  end if;
  execute new_src;
end $roster$;

do $verify_roster$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_liveness_coverage_ramp' in src) = 0
     or position('mon_detect_liveness_verification_sla' in src) = 0 then
    raise exception 'liveness detectors are not in the roster after registration';
  end if;
end $verify_roster$;

select cron.unschedule('liveness-coverage-snapshot')
 where exists (select 1 from cron.job where jobname = 'liveness-coverage-snapshot');
select cron.schedule('liveness-coverage-snapshot', '19 * * * *',
  $cron$ set statement_timeout to '300s'; select public.ops_liveness_snapshot_refresh(); $cron$);

-- Seed the first census now so the dashboard is answerable the moment this migration lands,
-- rather than at the top of the next hour.
select public.ops_liveness_snapshot_refresh();