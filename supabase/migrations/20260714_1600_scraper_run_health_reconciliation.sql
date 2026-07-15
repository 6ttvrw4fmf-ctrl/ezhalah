-- =============================================================================
-- supabase/migrations/20260714_scraper_run_health_reconciliation.sql
-- (repo 6ttvrw4fmf-ctrl/ezhalah, branch feat/scrape-reconciliation-alert-2026-07-14)
--
-- DESIGN ONLY — NOT APPLIED TO ANY DATABASE. Builds directly on commit 06e491e
-- on this branch (file supabase/migrations/20260714_scraper_health_reconciliation_
-- DESIGN_NOT_APPLIED.sql). Do not run apply_migration / execute this against
-- aannarbkwcymrotzwdbo without explicit owner review + approval (per
-- feedback_approval-workflow-rule and feedback_pr-based-deploy-workflow-rule
-- in project memory).
--
-- WHAT CHANGED FROM THE 06e491e DESIGN
-- -------------------------------------
-- Same shape (additive-only: is_active column + scraper_run_health_alerts
-- table + reconcile_scraper_run_health() function). Zero changes to
-- trigger_gh_workflow, scrape_runs, or the existing check_scraper_freshness()/
-- scraper_freshness_alerts pipeline — same as before.
--
-- Substantive change #1: the is_active=false seed list is broadened from just
-- 'toor' to all 7 platforms independently confirmed (2026-07-14, fresh
-- read-only queries against aannarbkwcymrotzwdbo) to be retired/superseded
-- with no recent scrape_runs activity:
--
--   platform      | total_runs | last_run_at (UTC)         | hours_since_last_run
--   --------------|------------|---------------------------|----------------------
--   aqar          | 4          | 2026-06-18 17:03:17.818471 | 630
--   aqar_sweep    | 3          | 2026-06-19 22:41:25.699040 | 600
--   aqar_liveness | 2          | 2026-06-20 21:24:58.201489 | 577
--   deal          | 2          | 2026-06-21 19:10:01.962866 | 556
--   semsar        | 1          | 2026-06-22 20:56:22.738411 | 530
--   dwelleo       | 4          | 2026-06-23 08:22:54.477715 | 518
--   toor          | 21         | 2026-07-06 13:48:16.549829 | 201
--
-- Substantive change #2 (found by adversarial re-verification of this
-- migration, 2026-07-14 — NOT in the original design, added here before
-- commit): `aqarmonthly` is a genuinely ACTIVE, in-cadence platform
-- (platform_cadence row: expected_hours=24, note='daily (jobid 23)') that
-- simply never writes to `scrape_runs` at all — it logs directly to its own
-- dedicated table (`aqarmonthly_residential_listings`; confirmed via
-- information_schema.tables) instead. Because the reconciliation loop below
-- pulls its first candidate set straight from `platform_cadence where
-- is_active` independent of whether that platform ever appears in
-- `scrape_runs`, aqarmonthly would otherwise get `runs_in_window=0` forever
-- and fire a PERMANENT false-positive `no_runs_in_window` critical alert on
-- every scheduled run — a real platform with no evidence of being unhealthy.
-- This is architecturally different from the 7 platforms above (those are
-- genuinely retired/superseded; aqarmonthly is live and shipping listings
-- today, just monitored through a different mechanism). It is seeded below
-- with is_active=false and an accurate note explaining why, so this
-- migration does not fire a false alarm the moment it's scheduled.
--
-- Without both of the above, scheduling reconcile_scraper_run_health() would
-- additionally flag all 6 of aqar / aqar_sweep / aqar_liveness / deal /
-- dwelleo / semsar AND aqarmonthly as 'no_runs_in_window' — false positives,
-- not the muktamel/alnokhba bug class this migration targets.
--
-- FRESH FULL RE-VERIFICATION (2026-07-14, read-only, pure SELECTs, nothing
-- created) — reproduces every claim in 06e491e and re-checks with the
-- broadened seed list above:
--
--  is_active NOT present on platform_cadence, scraper_run_health_alerts does
--  NOT exist (to_regclass both null/absent) — confirms 06e491e was never
--  applied.
--
--  Targeted check (10 platforms, expected_hours from platform_cadence or the
--  24h default):
--    platform          | runs_in_window | healthy_of_last3 | verdict
--    muktamel          | 8              | 0                 | ALERT all_recent_runs_unhealthy
--    alnokhba          | 6              | 0                 | ALERT all_recent_runs_unhealthy
--    abeea             | 6              | 2                 | not flagged
--    eastabha          | 6              | 2                 | not flagged
--    jazwtn            | 6              | 2                 | not flagged
--    souq24            | 4              | 3                 | not flagged
--    aqar_residential  | 1710           | 3                 | not flagged
--    aqar_commercial   | 216            | 3                 | not flagged
--    dealapp           | 6              | 3                 | not flagged
--    toor              | 0              | 0                 | ALERT no_runs_in_window
--                                                              (suppressed once
--                                                               is_active=false
--                                                               is seeded below)
--
--  Fleet-wide dry-run (all distinct non-shard platforms in scrape_runs, plus
--  aqarmonthly checked separately since it never appears there at all,
--  is_active simulated per the full seed list below):
--    would_alert_no_runs   = 0   (aqar/aqar_sweep/aqar_liveness/deal/dwelleo/
--                                 semsar/aqarmonthly all correctly suppressed)
--    would_alert_unhealthy = 2  -> ['muktamel', 'alnokhba']
--    not_flagged           = 30+
--  0 platforms remain falsely flagged; muktamel/alnokhba are the only two
--  alerts — matching the bug class this migration exists to catch.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Registry: make "is this platform still supposed to be running, and how
--    often" an explicit, queryable fact instead of an implicit assumption.
--    Additive only — every existing platform_cadence row defaults to
--    is_active=true (no behavior change) until explicitly flipped off below.
-- ---------------------------------------------------------------------------
alter table public.platform_cadence
  add column if not exists is_active boolean not null default true;

-- Seed retirement flags for the 7 platforms independently confirmed above to
-- have stopped reporting scrape_runs 200-630 hours ago while every other
-- platform in the fleet reported within the last 18 hours, PLUS aqarmonthly
-- (active, but architecturally excluded from this scrape_runs-based check —
-- see "Substantive change #2" above). This upsert only ever sets
-- is_active/note; it does not touch expected_hours for any row.
insert into public.platform_cadence (platform, expected_hours, note, is_active)
values
  ('toor',          24, 'retired 2026-07-06 per Fleet audit; last scrape_runs row 2026-07-06 13:48 UTC; excluded from reconciliation', false),
  ('aqar',          8,  'legacy cadence row; superseded by aqar_residential/aqar_commercial/aqarcity; last scrape_runs row 2026-06-18 17:03 UTC (4 runs total); excluded from reconciliation', false),
  ('aqar_sweep',    24, 'legacy; last scrape_runs row 2026-06-19 22:41 UTC (3 runs total); excluded from reconciliation', false),
  ('aqar_liveness', 24, 'one-time probe, never a maintained recurring scraper; last scrape_runs row 2026-06-20 21:24 UTC (2 runs total); excluded from reconciliation', false),
  ('deal',          24, 'legacy cadence row; superseded by dealapp; last scrape_runs row 2026-06-21 19:10 UTC (2 runs total); excluded from reconciliation', false),
  ('dwelleo',       24, 'legacy; last scrape_runs row 2026-06-23 08:22 UTC (4 runs total); excluded from reconciliation', false),
  ('semsar',        24, 'legacy; last scrape_runs row 2026-06-22 20:56 UTC (1 run total); excluded from reconciliation', false),
  ('aqarmonthly',   24, 'ACTIVE, not retired — logs to its own aqarmonthly_residential_listings table, never writes a scrape_runs row by design; monitored via check_scraper_freshness() against that table instead. Excluded here only to avoid a permanent false no_runs_in_window alert on this scrape_runs-based check.', false)
on conflict (platform) do update set is_active = excluded.is_active, note = excluded.note;

-- ---------------------------------------------------------------------------
-- 2. New table: append-only alert log. Deliberately NOT reusing
--    scraper_freshness_alerts (different meaning: that table alerts on stale
--    scraped_at/last_seen_at columns on the listing tables themselves, this
--    one alerts on scrape_runs self-reported outcomes). Keeping them separate
--    means zero risk of changing behavior for any existing consumer of
--    scraper_freshness_alerts.
-- ---------------------------------------------------------------------------
create table if not exists public.scraper_run_health_alerts (
  id               bigint generated always as identity primary key,
  checked_at       timestamptz not null default now(),
  platform         text not null,
  alert_type       text not null check (alert_type in ('no_runs_in_window', 'all_recent_runs_unhealthy')),
  expected_hours   integer not null,
  runs_in_window   integer not null,
  healthy_runs     integer not null,
  last_run_at      timestamptz,
  last_healthy_at  timestamptz,
  severity         text not null check (severity in ('warning', 'critical'))
);

create index if not exists scraper_run_health_alerts_platform_checked_idx
  on public.scraper_run_health_alerts (platform, checked_at desc);

-- ---------------------------------------------------------------------------
-- 3. Reconciliation function. Pure read of scrape_runs + platform_cadence,
--    writes only to the new alerts table above. Does not touch
--    trigger_gh_workflow, scrape_runs, or any of the ~30 GH Actions
--    workflows. Intended to be scheduled independently of jobid 31
--    (check_scraper_freshness, which is left completely untouched).
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_scraper_run_health()
returns table(platform text, alert_type text, severity text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rec record;
  v_runs_in_window int;
  v_last_run_at timestamptz;
  v_last_healthy_at timestamptz;
  v_healthy_of_last3 int;
  v_lookback interval;
begin
  for rec in
    select pc.platform, pc.expected_hours
    from public.platform_cadence pc
    where pc.is_active
    union
    -- base platforms actively reporting runs but with no explicit cadence
    -- row yet: default to a 24h expectation, matching
    -- check_scraper_freshness()'s existing coalesce(...,24) convention.
    select distinct sr.platform, 24
    from public.scrape_runs sr
    where sr.platform !~ ':'
      and sr.platform not like '%\_cleanup%' escape '\'
      and sr.platform not like '%\_liveness%' escape '\'
      and sr.platform not in (select platform from public.platform_cadence)
  loop
    v_lookback := (rec.expected_hours || ' hours')::interval * 6; -- 6 expected cycles

    select max(started_at) into v_last_run_at
    from public.scrape_runs where platform = rec.platform;

    select max(started_at) into v_last_healthy_at
    from public.scrape_runs
    where platform = rec.platform and coalesce(ok,false) = true and coalesce(rows_seen,0) > 0;

    select count(*) into v_runs_in_window
    from public.scrape_runs
    where platform = rec.platform and started_at > now() - v_lookback;

    if v_runs_in_window = 0 then
      -- Silence: either the dispatcher (trigger_gh_workflow / matrix shard)
      -- stopped firing, or the GH Actions run is failing before ever
      -- writing a scrape_runs row. Either way, is_active=true means this
      -- platform was expected to report and did not, at all, for 6 full
      -- expected cycles.
      insert into public.scraper_run_health_alerts
        (platform, alert_type, expected_hours, runs_in_window, healthy_runs,
         last_run_at, last_healthy_at, severity)
      values
        (rec.platform, 'no_runs_in_window', rec.expected_hours, 0, 0,
         v_last_run_at, v_last_healthy_at, 'critical');
      platform := rec.platform; alert_type := 'no_runs_in_window'; severity := 'critical';
      return next;
    else
      select count(*) filter (
        where rn <= 3 and coalesce(ok,false) = true and coalesce(rows_seen,0) > 0
      ) into v_healthy_of_last3
      from (
        select ok, rows_seen,
               row_number() over (order by started_at desc) rn
        from public.scrape_runs
        where platform = rec.platform
      ) x;

      if v_healthy_of_last3 = 0 then
        insert into public.scraper_run_health_alerts
          (platform, alert_type, expected_hours, runs_in_window, healthy_runs,
           last_run_at, last_healthy_at, severity)
        values
          (rec.platform, 'all_recent_runs_unhealthy', rec.expected_hours,
           v_runs_in_window, 0, v_last_run_at, v_last_healthy_at,
           case when v_last_healthy_at < now() - interval '14 days' or v_last_healthy_at is null
                then 'critical' else 'warning' end);
        platform := rec.platform; alert_type := 'all_recent_runs_unhealthy';
        severity := case when v_last_healthy_at < now() - interval '14 days' or v_last_healthy_at is null
                          then 'critical' else 'warning' end;
        return next;
      end if;
    end if;
  end loop;
end;
$function$;

-- NOT included in this migration (left for the owner's approval step):
--   select cron.schedule('scraper-run-health-check', '20 */6 * * *',
--     'select public.reconcile_scraper_run_health()');
-- Deliberately staged as a separate, explicit step so scheduling this new
-- check is its own reviewable decision, independent of the alert-table/
-- function design above.

commit;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (if this needs to be undone — additive only, safe to drop cleanly):
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.reconcile_scraper_run_health();
--   DROP TABLE IF EXISTS public.scraper_run_health_alerts;
--   ALTER TABLE public.platform_cadence DROP COLUMN IF EXISTS is_active;
--   COMMIT;
-- Note: dropping is_active also discards the 8 seeded exclusion notes (toor, aqar, aqar_sweep,
-- aqar_liveness, deal, dwelleo, semsar, aqarmonthly) — harmless, since they are pure bookkeeping
-- with no other reader. If cron.schedule('scraper-run-health-check', ...) was separately applied
-- per the note above, run `select cron.unschedule('scraper-run-health-check');` first.
-- ─────────────────────────────────────────────────────────────────────────────────────────
