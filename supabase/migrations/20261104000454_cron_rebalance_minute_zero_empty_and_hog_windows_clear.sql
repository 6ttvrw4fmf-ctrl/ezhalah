-- CRON REBALANCE (owner decision 6, 2026-11-03: "Yes, use your picks").
--
-- Alarms cron_minute_collision (3839) and cron_starvation_risk (3844). Re-slots 66 jobs by
-- minute only: no command changes, no hour changes (no work moves into or out of the 05-17 / 21-23
-- UTC heavy windows), and five cadence cuts where the hour is full (marked cut = true below).
--
-- What this does:
--   * minute 0 is EMPTY in every hour (was 3-5 jobs per hour): run-remediation and
--     mon-engineer-locked-out leave */15, alert-to-incident-bridge leaves */20, and the eleven daily
--     jobs that started on :00 start later in the same hour.
--   * refresh_listing_native_location_v1 :20 -> :16, so sync-search-listings-ar (:22) is no longer
--     inside its p95 window. That was the P1 half of 3844 (a starved index writer). The two keep the
--     advisory-lock ordering (location_pipeline:v1_refresh) and 17 still starts before 28.
--   * every hourly job the detector named as starved, except mon-p0-fast-lane, now starts outside the
--     :59-:10, :16-:21 and :22-:37 hog windows. mon-p0-fast-lane stays exactly as it is: its 24
--     minutes with a 3-minute worst gap are the owner-set 5-minute P0 SLO
--     (scripts/verify-p0-delivery-sla.ts), and no 24-slot list with gaps <= 3 can avoid a 34-minute
--     band.
--   * the worst (hour, minute) stack falls from 8 jobs to 4.
--
-- Cadence cuts (the hour is full: 142-158 starts an hour against 59 usable minutes):
--   mon-search-latency-sample 12/h -> 4/h, refresh-mon-audit-counts 2/h -> 1/h,
--   mon-watchdog-detector-job 2/h -> 1/h (job 38 runs once an hour), mon-alert-flapping 2/h -> 1/h,
--   mon-remediation-worker-stale 2/h -> 1/h.
--
-- What it cannot do, measured: "at most one job per minute" needs <= 60 starts an hour; this
-- instance has 130-145 after the cuts, so cron_minute_collision stays open at max 4 per instant.
-- cron_starvation_risk stays open on mon-p0-fast-lane alone.
--
-- Fail-closed: every row must name exactly one active job whose CURRENT schedule is the one this
-- migration was written against; otherwise nothing changes.
do $mig$
declare
  r record;
  v_id bigint;
  v_cur text;
  v_n int;
begin
  for r in
    select * from (values
    ('gh-aqar-commercial', '15 */8 * * *', '20 */8 * * *', false),
    ('gh-aqar-liveness', '0 1 * * *', '30 1 * * *', false),
    ('gh-wasalt-enrich', '0 5 * * *', '24 5 * * *', false),
    ('gh-aqar-cleanup', '0 2 * * *', '20 2 * * *', false),
    ('gh-wasalt-cleanup', '0 3 * * *', '19 3 * * *', false),
    ('stale-listings-mark', '0 4 * * *', '20 4 * * *', false),
    ('gh-gathern-daily', '40 4 * * *', '8 4 * * *', false),
    ('refresh_listing_native_location_v1', '20 * * * *', '16 * * * *', false),
    ('gh-aqarmonthly-daily', '0 6 * * *', '24 6 * * *', false),
    ('location-selftest-hourly', '45 * * * *', '52 * * * *', false),
    ('novel-type-alarm', '27 * * * *', '41 * * * *', false),
    ('location-pipeline-monitor', '17 * * * *', '52 * * * *', false),
    ('resolve-english-city-overlay', '50 * * * *', '54 * * * *', false),
    ('gh-wasalt-enum-liveness', '0 21 */2 * *', '9 21 */2 * *', false),
    ('gh-wasalt-enrich-ar', '15 5,17 * * *', '30 5,17 * * *', false),
    ('wasalt-enrich-backlog-monitor', '3 * * * *', '45 * * * *', false),
    ('mon-district-resolution', '52 * * * *', '51 * * * *', false),
    ('district-recovery-pipeline', '10 * * * *', '43 * * * *', false),
    ('refresh-rnpl-flags', '20 * * * *', '52 * * * *', false),
    ('gh-gathern-cleanup', '0 3 * * *', '2 3 * * *', false),
    ('refresh-mon-audit-counts', '14,52 * * * *', '39 * * * *', true),
    ('mon-watchdog-detector-job', '9,39 * * * *', '51 * * * *', true),
    ('resolve-raghdan-city', '16 * * * *', '44 * * * *', false),
    ('mon-searchability-snapshot', '15 3 * * *', '22 3 * * *', false),
    ('mon-aqar-ppm-as-total', '25 * * * *', '55 * * * *', false),
    ('mon-pii-capture-sweep', '55 * * * *', '43 * * * *', false),
    ('sync-rich-attrs-wasalt', '46 */3 * * *', '30 */3 * * *', false),
    ('gh-verify-deletions', '0 5 * * 0', '27 5 * * 0', false),
    ('gh-alert-dispatch-backstop', '24 * * * *', '39 * * * *', false),
    ('liveness-coverage-snapshot', '19 * * * *', '45 * * * *', false),
    ('mon-search-latency-sample', '2,6,9,12,14,23,30,33,40,49,53,56 * * * *', '13,41,49,57 * * * *', true),
    ('refresh-district-display-canon', '8 * * * *', '14 * * * *', false),
    ('gh-muktamel-sharded', '45 3 * * *', '24 3 * * *', false),
    ('mon-alert-flapping', '2,32 * * * *', '40 * * * *', true),
    ('refresh-loader-scale-stats', '35 * * * *', '58 * * * *', false),
    ('run-remediation', '*/15 * * * *', '3-59/15 * * * *', false),
    ('mon-remediation-worker-stale', '13,43 * * * *', '14 * * * *', true),
    ('alert-to-incident-bridge', '*/20 * * * *', '9-59/20 * * * *', false),
    ('mon-rent-tiny-gate-reverted', '35 6 * * *', '30 6 * * *', false),
    ('refresh-listing-source-district-ar-fleet', '41 */3 * * *', '20 */3 * * *', false),
    ('gh-fleet-cleanup', '46 6 * * *', '8 6 * * *', false),
    ('gh-aqar-deep-fill', '40 3,15 * * *', '6 3,15 * * *', false),
    ('gh-aqar-commercial-fill', '40 9,21 * * *', '6 9,21 * * *', false),
    ('gh-af-score', '0 8 * * *', '20 8 * * *', false),
    ('gh-af-robot', '41 * * * *', '13 * * * *', false),
    ('ops-zero-result-log-retention', '41 3 * * *', '8 3 * * *', false),
    ('scraper-early-warning', '45 7 * * *', '23 7 * * *', false),
    ('scraper-field-fill-losses', '50 4 * * 1', '27 4 * * 1', false),
    ('gh-aqar-liveness-recheck', '0 13 * * *', '2 13 * * *', false),
    ('reactivate-recovered-dormant-platforms', '15 * * * *', '12 * * * *', false),
    ('gh-moj-district-sales', '41 17 * * 6', '19 17 * * 6', false),
    ('gh-fleet-liveness-recheck-2', '47 20 * * *', '6 20 * * *', false),
    ('mon-engineer-locked-out', '*/15 * * * *', '2-59/15 * * * *', false),
    ('mon-unknown-named-district', '41 4 * * *', '23 4 * * *', false),
    ('mon-district-blank-unexplained', '47 4 * * *', '30 4 * * *', false),
    ('refresh-district-list-after-sync', '33 * * * *', '50 * * * *', false),
    ('gh-engineer-automerge', '7,22,37,52 * * * *', '12,38,47,56 * * * *', false),
    ('strip-far-from-city-pins', '16 * * * *', '11 * * * *', false),
    ('gh-facts-words-nightly', '1 * * * *', '42 * * * *', false),
    ('gh-facts-ai-new', '40 7 * * *', '8 7 * * *', false),
    ('mon-one-sided-platforms', '47 4 * * *', '25 4 * * *', false),
    ('mon-af-new-listing-readiness', '52 8 * * *', '29 8 * * *', false),
    ('title-district', '5 * * * *', '58 * * * *', false),
    ('map_grid_refresh_ar', '45 * * * *', '53 * * * *', false),
    ('mon-resolve-ended-scrape-blocks', '16 * * * *', '56 * * * *', false),
    ('gh-scrape-alarm-backstop', '53 */3 * * *', '36 */3 * * *', false)
    ) as t(jobname, old_schedule, new_schedule, cut)
  loop
    select count(*), min(jobid), min(schedule) into v_n, v_id, v_cur
      from cron.job where jobname = r.jobname and active;
    if v_n <> 1 then
      raise exception 'cron rebalance: % active jobs named %, expected exactly 1', v_n, r.jobname;
    end if;
    if v_cur is distinct from r.old_schedule then
      raise exception 'cron rebalance: % is on "%" not "%" -- re-read production before re-slotting',
        r.jobname, v_cur, r.old_schedule;
    end if;
    perform cron.alter_job(job_id := v_id, schedule := r.new_schedule);
  end loop;

  -- post-conditions, read back from cron.job
  if exists (
    select 1 from public.ops_cron_start_instants() where minute = 0
  ) then
    raise exception 'cron rebalance: a job still starts on minute 0';
  end if;
  if exists (
    select 1 from public.mon_cron_starved_schedules() where victim_jobname <> 'mon-p0-fast-lane'
  ) then
    raise exception 'cron rebalance: a job other than mon-p0-fast-lane is still inside a hog window';
  end if;
  if exists (
    select 1 from public.ops_cron_start_instants() group by hour, minute having count(*) > 4
  ) then
    raise exception 'cron rebalance: an (hour, minute) still starts more than 4 jobs';
  end if;
  if exists (
    select 1 from public.ops_cron_start_instants() where writer_fn is not null
     group by hour, minute having count(*) >= 2
  ) then
    raise exception 'cron rebalance: two single-writer jobs share an (hour, minute)';
  end if;
end
$mig$;