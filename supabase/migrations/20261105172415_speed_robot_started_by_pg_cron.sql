-- THE PHONE SPEED ROBOT RUNS EVERY ~30 MINUTES, FOR REAL (owner 2026-11-05: «we need a robot GitHub to check it always»).
-- site-speed-live.yml asked GitHub for '9,39 * * * *' (48 runs a day) but GitHub dropped most scheduled runs on this
-- busy repo: 15 schedule runs in ~5 days (about 3 a day). The robot that times open, map, drag, search and tap was
-- therefore mostly asleep. Like every other robot here, pg_cron now starts it: one literal trigger step in each of the
-- two hourly bundles that run ~31 minutes apart (:12 resolvers, :43 monitors) — no new cron start, so the rebalanced
-- hour (owner decision 6: no free minute is left for a new job) is untouched. The workflow keeps its own GitHub
-- schedule only as a backup.
select cron.schedule('bundle-hourly-resolvers', '12 * * * *', $cmd$set statement_timeout to '240s'; select public.ops_run_cron_bundle('bundle-hourly-resolvers',
  $s$select public.reactivate_recovered_dormant_platforms()$s$,
  $s$select public.resolve_small_platform_cities()$s$,
  $s$select public.resolve_amlakalahsa_locations()$s$,
  $s$select public.resolve_raghdan_city()$s$,
  $s$select public.rebuild_age_producer()$s$,
  $s$select public.trigger_gh_workflow('site-speed-live.yml')$s$);$cmd$);

select cron.schedule('bundle-hourly-monitors', '43 * * * *', $cmd$set statement_timeout to '900s'; select public.ops_run_cron_bundle('bundle-hourly-monitors',
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
  $s$select public.trigger_gh_workflow('auto-deploy-merged-fixes.yml')$s$,
  $s$select public.trigger_gh_workflow('site-speed-live.yml')$s$);$cmd$);
