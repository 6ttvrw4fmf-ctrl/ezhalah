-- Merged app fixes ship hourly again: pg_cron dispatches auto-deploy-merged-fixes.yml (🔧 repair 2026-11-04 PM).
-- Owner 2026-11-01: a merged src/ fix reaches customers through auto-deploy-merged-fixes.yml «hourly». Its only
-- trigger was GitHub's `cron: '40 * * * *'`, and GitHub drops scheduled runs: measured 2026-11-03/04 it fired at
-- 18:00, 23:37, 03:13, 11:29, 18:50 — every 4–8 h, not hourly — so a fix merged at 21:51 (#10535, /support) would
-- wait hours. engineer-automerge.yml already has this exact backup (bundle-quarter-hour → trigger_gh_workflow);
-- the deploy robot did not. This adds the same one-line dispatch to bundle-hourly-monitors (:43, schedule
-- unchanged). Nothing about the deploy is loosened: the workflow still runs once per main commit, stops after 3
-- failed deploys, and deploy-frontend.yml keeps the deploy lock, the preflight and the 10% canary.
select cron.alter_job(
  job_id  := (select jobid from cron.job where jobname = 'bundle-hourly-monitors'),
  command := $cmd$set statement_timeout to '900s'; select public.ops_run_cron_bundle('bundle-hourly-monitors',
  $s$select public.mon_detect_remediation_worker_stale()$s$,
  $s$select public.mon_detect_alert_flapping()$s$,
  $s$select public.mon_check_normal_filter_barrier()$s$,
  $s$select public.detect_novel_property_types()$s$,
  $s$select public.mon_scan_pii_capture_batch(15000)$s$,
  $s$select public.mon_af_predicate_parity()$s$,
  $s$select public.mon_detect_cron_starvation_risk()$s$,
  $s$select public.mon_detect_wasalt_enrich_backlog()$s$,
  $s$select public.mon_detect_sync_ran_against_stale_snapshot()$s$,
  $s$select public.mon_detect_district_resolution()$s$,
  $s$select public.mon_watchdog_detector_job()$s$,
  $s$select public.mon_check_filter_parity_legacy()$s$,
  $s$select public.mon_resolve_ended_scrape_blocks()$s$,
  $s$select public.mon_detect_search_writer_starved()$s$,
  $s$select public.ops_liveness_snapshot_refresh()$s$,
  $s$select public.mon_detect_aqar_ppm_as_total()$s$,
  $s$select public.trigger_gh_workflow('alert-dispatch.yml')$s$,
  $s$select public.trigger_gh_workflow('migration-drift-guard.yml')$s$,
  $s$select public.trigger_gh_workflow('repair-enrollment-guard.yml')$s$,
  $s$select public.trigger_gh_workflow('af-robot.yml')$s$,
  $s$select public.trigger_gh_workflow('facts-words.yml')$s$,
  $s$select public.trigger_gh_workflow('auto-deploy-merged-fixes.yml')$s$);$cmd$);