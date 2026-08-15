-- ROSTER REPAIR (run #22, 2026-08-15) — self-inflicted, caught in the same session, same class as
-- 2026-08-04, 2026-08-10 (twice). The preceding migration in this run
-- (mon_detect_rent_period_contradicts_source_probe) wired its new detector by doing a wholesale
-- CREATE OR REPLACE of mon_run_all_detectors() from an ASSUMED body, replacing the explicit roster
-- array with dynamic `select proname ... like 'mon\_detect\_%'` discovery.
--
-- Why that is wrong, not merely different — three ways:
--   1. Detectors are deliberately EXCLUDED from this roster because they run on their OWN cron jobs:
--      price_fidelity(42), district_resolution(43), wasalt_enrich_backlog(40), aqar_ppm_as_total(63),
--      refresh_coverage(58), price_magnitude_gate(59), filter_barrier via mon_check_normal_filter_barrier(64).
--      Dynamic discovery double-runs every one of them, twice an hour, and several drive real RPCs.
--   2. mon_detect_orphaned_detectors() becomes vacuous: nothing can be orphaned from a roster that
--      enumerates itself, so the barrier that has caught this exact mistake three times goes dark.
--   3. It is the precise failure 20260810222259 exists to prevent: "a hand-copied full body is how
--      this keeps happening; a guarded needle-edit cannot lose an entry it never read."
--
-- This restores the explicit-array form, with the roster contents taken from the live sweep captured
-- at 07:05:38Z THIS run — i.e. the roster as it actually stood before the clobber — plus the one
-- genuinely new detector. Body shape restored from 20260810175245 (crash isolation, per-detector
-- ERROR capture, dated detector_crash dedup key) with the open_alerts return from 20260810222259.

create or replace function public.mon_run_all_detectors()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  fns text[] := array[
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
    'mon_detect_source_limited_contradicted',
    'mon_detect_search_performance_regression',
    'mon_detect_commercial_coverage_blind_spot',
    'mon_detect_rent_period_contradicts_capture',
    'mon_detect_served_after_source_confirmed_gone',
    'mon_detect_search_index_diverges_from_sync_source',
    'mon_detect_priceless_rent_with_labelled_source_price',
    'mon_detect_rent_period_contradicts_probe',  -- new, run #22 (2026-08-15)
    'mon_detect_orphaned_detectors'
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

-- Prove the restore is complete rather than trusting the paste (the whole point of this class of bug):
-- every detector observed in the 07:05:38Z pre-clobber sweep must be present in the array.
do $$
declare v_def text; missing text[] := '{}'; fn text;
  expected text[] := array[
    'mon_detect_cron_health','mon_detect_volume_drop','mon_detect_stale_refresh',
    'mon_detect_alert_delivery','mon_detect_deletion_spike','mon_detect_zero_new_stall',
    'mon_detect_field_integrity','mon_detect_registry_orphans','mon_detect_rls_reachability',
    'mon_detect_sql_mirror_drift','mon_detect_mass_inactivation','mon_detect_quarantine_growth',
    'mon_detect_zero_price_served','mon_detect_deploy_lock_misuse','mon_detect_orphaned_detectors',
    'mon_detect_dangling_scrape_run','mon_detect_legacy_alert_tables','mon_detect_orphaned_search_row',
    'mon_detect_filter_barrier_leaks','mon_detect_price_eq_area_or_ppm','mon_detect_silent_scraper_death',
    'mon_detect_cron_minute_collision','mon_detect_english_district_leak','mon_detect_impossible_price_size',
    'mon_detect_loc_rel_capacity_risk','mon_detect_price_source_mismatch','mon_detect_stale_active_fraction',
    'mon_detect_dealapp_shard_coverage','mon_detect_search_index_freshness','mon_detect_searchability_collapse',
    'mon_detect_stalled_daily_detector','mon_detect_rent_period_both_branch','mon_detect_rent_period_unreachable',
    'mon_detect_unverified_inactivation','mon_detect_location_predicate_drift','mon_detect_manufactured_rent_period',
    'mon_detect_price_size_contamination','mon_detect_unsortable_served_listing','mon_detect_url_collisions_res_vs_com',
    'mon_detect_trending_district_dead_end','mon_detect_buy_token_price_suppression',
    'mon_detect_period_branch_contradiction','mon_detect_rent_period_source_mismatch',
    'mon_detect_source_limited_contradicted','mon_detect_search_performance_regression',
    'mon_detect_commercial_coverage_blind_spot','mon_detect_rent_period_contradicts_capture',
    'mon_detect_served_after_source_confirmed_gone','mon_detect_search_index_diverges_from_sync_source',
    'mon_detect_priceless_rent_with_labelled_source_price'];
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array expected loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if array_length(missing, 1) > 0 then
    raise exception 'roster restore INCOMPLETE — still missing: %', array_to_string(missing, ', ');
  end if;
  if position('''mon_detect_rent_period_contradicts_probe''' in v_def) = 0 then
    raise exception 'new run #22 detector not wired';
  end if;
end $$;