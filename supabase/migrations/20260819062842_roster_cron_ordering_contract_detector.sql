-- Roster entry for mon_detect_cron_ordering_contract (Senior Production Engineer run #30).
-- A detector nothing reaches is decoration; mon_detect_orphaned_detectors fires on exactly that.
CREATE OR REPLACE FUNCTION public.mon_run_all_detectors()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  fns text[] := array[
    'mon_detect_discarded_location_resolution',
    'mon_detect_silent_scraper_death',
    'mon_detect_zero_new_stall',
    'mon_detect_stale_active_fraction',
    'mon_detect_volume_drop',
    'mon_detect_cron_health',
    'mon_detect_stale_refresh',
    'mon_detect_legacy_alert_tables',
    'mon_detect_field_integrity',
    'mon_detect_search_index_freshness',
    'mon_detect_quarantine_growth',
    'mon_detect_registry_orphans',
    'mon_detect_rls_reachability',
    'mon_detect_mass_inactivation',
    'mon_detect_english_district_leak',
    'mon_detect_impossible_price_size',
    'mon_detect_unverified_inactivation',
    'mon_detect_deletion_spike',
    'mon_detect_buy_token_price_suppression',
    'mon_detect_price_source_mismatch',
    'mon_detect_dangling_scrape_run',
    'mon_detect_cron_minute_collision',
    'mon_detect_alert_delivery',
    'mon_detect_sql_mirror_drift',
    'mon_detect_zero_price_served',
    'mon_detect_deploy_lock_misuse',
    'mon_detect_orphaned_search_row',
    'mon_detect_filter_barrier_leaks',
    'mon_detect_price_eq_area_or_ppm',
    'mon_detect_loc_rel_capacity_risk',
    'mon_detect_dealapp_shard_coverage',
    'mon_detect_searchability_collapse',
    'mon_detect_stalled_daily_detector',
    'mon_detect_rent_period_both_branch',
    'mon_detect_rent_period_unreachable',
    'mon_detect_location_predicate_drift',
    'mon_detect_manufactured_rent_period',
    'mon_detect_price_size_contamination',
    'mon_detect_unsortable_served_listing',
    'mon_detect_url_collisions_res_vs_com',
    'mon_detect_trending_district_dead_end',
    'mon_detect_period_branch_contradiction',
    'mon_detect_rent_period_source_mismatch',
    'mon_detect_gathern_rating_source_truth',
    'mon_detect_monthly_af_exactness',
    'mon_detect_wasalt_annualisation_fabricated',
    'mon_detect_source_limited_contradicted',
    'mon_detect_search_performance_regression',
    'mon_detect_commercial_coverage_blind_spot',
    'mon_detect_rent_period_contradicts_capture',
    'mon_detect_served_after_source_confirmed_gone',
    'mon_detect_search_index_diverges_from_sync_source',
    'mon_detect_priceless_rent_with_labelled_source_price',
    'mon_detect_rent_period_contradicts_probe',
    'mon_detect_filter_default_suppresses_inventory',
    'mon_detect_unresolvable_detector',
    'mon_detect_liveness_cap_degraded',
    'mon_detect_summary_only_capture',
    'mon_detect_district_bridge_leak',
    'mon_detect_scraper_failure_step_change',
    'mon_detect_card_attr_value_shape',
    'mon_detect_orphaned_detectors', 'mon_detect_unlocated_search_contract', 'mon_detect_rent_period_contract', 'mon_detect_city_resolution_ignores_region', 'mon_detect_district_only_city_inference', 'mon_detect_unprobed_source_waiver', 'mon_detect_english_overlay_stranded_city', 'mon_detect_run_log_timestamps_inverted',
    'mon_detect_cron_ordering_contract'
  ];
  fn text; raised int; result jsonb := '{}'::jsonb; failed text[] := '{}';
begin
  foreach fn in array fns loop
    begin
      execute format('select public.%I()', fn) into raised;
      result := result || jsonb_build_object(replace(fn, 'mon_detect_', ''), raised);
    exception when others then
      failed := failed || fn;
      result := result || jsonb_build_object(replace(fn, 'mon_detect_', ''), 'ERROR: ' || sqlerrm);
      begin
        perform public.mon_raise('P1', 'detector_crash', 'all',
          'detector_crash:' || fn || ':' || current_date,
          jsonb_build_object('detector', fn, 'sqlstate', sqlstate, 'error', sqlerrm));
      exception when others then
        null;
      end;
    end;
  end loop;
  -- open_alerts is NOT the same claim as "every count 0": mon_raise() returns 0 for an already-open
  -- dedup key, so an all-zero sweep can sit on top of standing alerts (2026-08-10). Read both.
  return result || jsonb_build_object('ran_at', now(), 'failed', to_jsonb(failed),
    'open_alerts', (select coalesce(jsonb_object_agg(severity, c), '{}'::jsonb)
                      from (select severity, count(*) c from public.alert_event
                             where resolved_at is null group by severity) s));
end $function$;
