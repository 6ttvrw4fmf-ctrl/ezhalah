-- =============================================================================
-- DESIGN ONLY — NOT APPLIED TO ANY DATABASE.
-- Prepared 2026-07-14 as branch-only investigation output. Do not run
-- apply_migration / execute this against aannarbkwcymrotzwdbo without an
-- explicit owner review + approval (per feedback_approval-workflow-rule and
-- feedback_pr-based-deploy-workflow-rule in project memory).
--
-- PROBLEM THIS FIXES
-- -------------------
-- public.trigger_gh_workflow(wf text) (live def, confirmed via pg_get_functiondef):
--
--   CREATE OR REPLACE FUNCTION public.trigger_gh_workflow(wf text)
--    RETURNS void
--    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','vault','net'
--   AS $function$
--   declare tok text;
--   begin
--     select decrypted_secret into tok from vault.decrypted_secrets
--       where name = any(array['github','github_pat']) limit 1;
--     if tok is null then
--       raise notice 'github PAT not in Vault yet; skipping %', wf;
--       return;
--     end if;
--     perform net.http_post(
--       url := 'https://api.github.com/repos/6ttvrw4fmf-ctrl/ezhalah/actions/workflows/' || wf || '/dispatches',
--       headers := jsonb_build_object(...),
--       body := jsonb_build_object('ref', 'main')
--     );
--   end;
--   $function$
--
-- `perform net.http_post(...)` discards the return value (request id / response),
-- and the function RETURNS void with no follow-up check of the dispatched
-- workflow's actual run outcome. cron.job_run_details therefore only ever
-- records whether the *dispatch call itself* executed inside Postgres
-- (status='succeeded', return_message='1 row' every time) — it carries zero
-- information about whether the GitHub Actions workflow that was dispatched
-- subsequently ran, failed, or produced any data. Confirmed live:
--
--   jobid | jobname             | status    | return_message
--   14    | gh-muktamel-weekly  | succeeded | 1 row   (2026-07-13 03:00:00)
--   14    | gh-muktamel-weekly  | succeeded | 1 row   (2026-07-06 03:00:00)
--   14    | gh-muktamel-weekly  | succeeded | 1 row   (2026-06-29 03:00:00)
--
-- ...while public.scrape_runs shows muktamel's last 2 runs (ids 8178, 11715)
-- stuck with finished_at=null, ok=null (never reported finish), and the runs
-- before those reaped with ok=false, rows_seen=0, notes='[reaped: abandoned
-- run, never reported finish]'. muktamel has not produced a single successful
-- row since at least 2026-06-22. cron says "succeeded" the entire time.
--
-- Similarly alnokhba (dispatched as one shard of the small-sources-sync.yml
-- matrix, jobid 12 'gh-small-sources') has ok=true, rows_seen=0 on every one
-- of its last 7 consecutive daily runs (ids 9229..12229, 2026-07-08 through
-- 2026-07-14), down from a stable 5-6 rows_seen/run in the weeks before. The
-- scraper itself self-reports ok=true (it didn't crash), but it is silently
-- returning nothing — a class of failure cron.job_run_details can never see,
-- because it never asks GitHub what happened after dispatch.
--
-- WHY NOT: touch the ~30 GH Actions workflows / add a Supabase callback.
--   That would mean editing every scraper's workflow YAML (large blast
--   radius, one bug = 30 potential breakages) to add a "report back to
--   Supabase" step. The data needed to tell healthy-zero from broken-zero
--   is *already* being written today by every scraper via its existing
--   scrape_runs self-report (ok, rows_seen). No scraper code changes needed.
--
-- THIS FIX: a new, additive, read-only reconciliation function that cross-
-- references scrape_runs (ground truth on what actually happened) against
-- each platform's expected cadence, and writes alerts to a NEW table. It
-- does not modify trigger_gh_workflow, does not modify scrape_runs, does not
-- modify the existing check_scraper_freshness()/scraper_freshness_alerts
-- pipeline (which answers a different question — "is the underlying listing
-- table's scraped_at/last_seen_at stale" — and would NOT catch alnokhba's
-- bug, since a scraper that re-touches 0 rows can still leave last_seen_at
-- looking arbitrarily "fresh" on rows it isn't touching at all).
--
-- KEY SEMANTIC FINDING (read-only, verified against 14 days of scrape_runs):
--   rows_seen is a *total encountered this run* counter, not a *new-only*
--   counter. A healthy platform's rows_seen is stable near its live catalog
--   size every run (e.g. abeea notes='gone=84 pruned=0', rows_seen=140,
--   run after run) — NOT the count of new listings. That means rows_seen=0
--   does not mean "zero new," it means "the scraper touched literally
--   nothing," which is only legitimate if the platform's entire catalog is
--   genuinely empty. This resolves the false-positive risk in the brief:
--   there is no real "zero-new-but-healthy" state to protect against in this
--   schema, because "seen" already means "total," not "new." The real risk
--   is a single transient blip (network hiccup, one bad run) vs a SUSTAINED
--   run of bad reports — hence "last N expected runs must ALL be bad" below,
--   not "any run was bad."
--
-- FALSE-POSITIVE CHECK PERFORMED (read-only, live data, last 14 days):
--   platform   | runs_in_lookback | healthy_of_last_3 | verdict
--   alnokhba   | 3                | 0                  | FLAG (matches brief)
--   muktamel   | 3                | 0                  | FLAG (matches brief)
--   abeea      | 6                | 2/3                | NOT flagged (1 blip, recovered)
--   eastabha   | 6                | 2/3                | NOT flagged (1 blip, recovered)
--   jazwtn     | 6                | 2/3                | NOT flagged (1 blip, recovered)
--   souq24     | 4                | 3/3                | NOT flagged
--   toor       | 0 (in 144h)      | n/a                | NOT flagged by the lookback-
--              |                  |                    | filtered query as written,
--              |                  |                    | BUT see "KNOWN GAP" below —
--              |                  |                    | toor is retired (Fleet audit,
--              |                  |                    | 2026-07-06) and must be listed
--              |                  |                    | in the is_active=false seed
--              |                  |                    | data below, or a stricter
--              |                  |                    | "no runs at all" check would
--              |                  |                    | wrongly flag every retired
--              |                  |                    | platform as "silently died."
--
-- KNOWN GAP fixed by this design: a naive "are the last N runs all bad"
-- check silently DROPS a platform that has stopped reporting runs at all
-- (rn <= 3 has nothing to select). That is actually the *worst* failure mode
-- (total silence), so this design evaluates staleness (time since last run
-- vs expected_hours) and run-health (content of last N runs) as two
-- independent checks, and gates both on an explicit is_active registry flag
-- so intentionally retired platforms (toor) are excluded rather than
-- papered over by "no data = no alert."
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Registry: make "is this platform still supposed to be running, and how
--    often" an explicit, queryable fact instead of an implicit assumption.
--    Additive only — reuses the existing platform_cadence table, adds one
--    nullable-safe column with a default that preserves current behavior
--    (every existing row defaults to is_active=true, i.e. no behavior change
--    until someone flips a specific platform off).
-- ---------------------------------------------------------------------------
alter table public.platform_cadence
  add column if not exists is_active boolean not null default true;

-- Seed retirement flags for platforms already confirmed retired/paused by
-- prior audits in project memory (Fleet audit 2026-07-09: "toor retired
-- 07-06"). Verified live above: toor has zero scrape_runs rows after
-- 2026-07-06 13:48:16 — consistent with intentional retirement, not silent
-- death. This UPSERT only sets is_active; it does not touch expected_hours
-- for platforms not listed (they keep whatever platform_cadence already has,
-- or fall back to the function's own 24h default for platforms with no row
-- at all — see step 3).
insert into public.platform_cadence (platform, expected_hours, note, is_active)
values ('toor', 24, 'retired 2026-07-06 per Fleet audit; excluded from reconciliation', false)
on conflict (platform) do update set is_active = excluded.is_active, note = excluded.note;

-- ---------------------------------------------------------------------------
-- 2. New table: append-only alert log. Deliberately NOT reusing
--    scraper_freshness_alerts (different meaning: that table alerts on stale
--    scraped_at/last_seen_at columns on the listing tables themselves, this
--    one alerts on scrape_runs self-reported outcomes). Keeping them
--    separate means zero risk of changing behavior for any existing
--    consumer of scraper_freshness_alerts.
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
