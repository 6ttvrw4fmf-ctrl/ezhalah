-- Data Integrity run 2026-08-29 — the two safety workflows still on GitHub's `schedule:` trigger
-- are running at ~10% of their declared cadence, and nothing measured that.
--
-- MEASURED, both workflows, over the same window (GitHub Actions run history, event=schedule):
--   alert-dispatch.yml        declares '9,39 * * * *'  = 48 runs/day.  Actual: 19 scheduled runs in
--                             ~3.5 days ≈ 5.4/day  ≈ 11% of cadence.
--   migration-drift-guard.yml declares '*/15 * * * *'  = 96 runs/day.  Actual: 30 scheduled runs in
--                             ~3 days   ≈ 10/day   ≈ 10% of cadence.
-- They fire at nearly the SAME timestamps (03:19/03:20, 21:29/21:29, 27T14:33/14:34, 26T22:26/22:24,
-- 26T16:02/16:02), which is what rules out a per-workflow bug: GitHub's scheduled-run dispatcher wakes
-- this repo a handful of times a day and then fires everything that is due at once.
--
-- WHY IT MATTERS, in the words of the things themselves:
--   * alert-dispatch.yml is "the missing last mile of the barrier system" — a barrier that detects a
--     serious problem nobody receives is incomplete protection. mon_detect_alert_delivery() raised
--     P1 alert_delivery_undelivered at 07:29 today with 2 alerts (1 P1, 1 P2) past the 60-minute
--     grace window. The severity filter is correct (P0/P1/P2); the workflow simply had not run.
--   * migration-drift-guard.yml carries an AGENTS.md P0 guarantee: it "runs every 15 minutes,
--     independent of any push — because the failure mode this exists for is a session that applies a
--     migration and pushes nothing at all." At ~10/day that guarantee does not hold.
--
-- THE ARCHITECTURE ALREADY DECIDED THIS, and these two were never migrated. Every scraper in the
-- fleet is dispatched from pg_cron via trigger_gh_workflow() (jobids 2,3,4,5,6,8,9,10,12,15,23,36,
-- 39,48,49,51,56,72,78) and every one of them fires punctually — jobid 38 hits :29/:59 and jobid 28
-- hits :14 to the second, all day. pg_cron's clock is reliable; GitHub's schedule trigger is not.
--
-- This is a BACKSTOP, deliberately additive: the YAML `schedule:` blocks are left exactly as they
-- are (scripts/verify-migration-drift-guard-wired.ts pins that '*/N' cron and would fail if it were
-- loosened — this does not touch it), and both workflows already declare workflow_dispatch, which is
-- what the API dispatch uses. Both carry a concurrency group, so a duplicate dispatch queues rather
-- than racing.
--
-- CRON DISCIPLINE (2026-08-10 stampede, 522 outage): minutes :24 and :42 are the only minutes with
-- ZERO hourly jobs. mon_detect_cron_minute_collision() raises at >=3 hourly jobs on one minute (or
-- >1 on :00), so each of these lands as the sole occupant of its slot. Neither is :00/:15/:20. Each
-- job is a single net.http_post — no scan, no lock, no measurable load.
select cron.schedule('gh-alert-dispatch-backstop', '24 * * * *',
  $cron$select public.trigger_gh_workflow('alert-dispatch.yml')$cron$);

select cron.schedule('gh-migration-drift-guard-backstop', '42 * * * *',
  $cron$select public.trigger_gh_workflow('migration-drift-guard.yml')$cron$);
