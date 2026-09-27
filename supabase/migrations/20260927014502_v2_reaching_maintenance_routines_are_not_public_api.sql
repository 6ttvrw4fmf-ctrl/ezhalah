-- Maintenance routines that reach listing_native_location_v2 are NOT public API (2026-09-27, owner-approved).
--
-- Planning any query over listing_native_location_v2 costs ~270 MB of planner memory (measured with
-- EXPLAIN (MEMORY)); the 8 GB instance restarted four times on 2026-09-26 from cron load alone. Every
-- routine below had PUBLIC + anon + authenticated EXECUTE, so anyone holding the publishable key could make
-- the database plan that view through /rest/v1/rpc/<name>, in a loop:
--   * 26 read v2 (or a view built on it) directly;
--   * 18 are wrappers that call those, most of them SECURITY DEFINER, so revoking only the inner routine
--     would still leave the heavy path open through the wrapper;
--   * mon_run_all_detectors, mon_run_p0_detectors and run_remediation dispatch detectors and repairs by
--     name, the last two as the owner.
--
-- Nothing legitimate is lost (checked 2026-09-27):
--   * edge_logs 2026-09-19..27: zero /rpc/ calls to any of these 47;
--   * repo: no rpc('<name>') or /rpc/<name> caller; every hit is a barrier reading SQL text;
--   * no function called through PostgREST in those 8 days calls any of them as the caller (the one textual
--     hit, ops_p0_detectors_off_fast_lane, only reads their source from pg_proc);
--   * every routine is owned by postgres, every pg_cron job runs as postgres, and service_role has its own
--     explicit grant on all 47, so cron and service-role scripts keep working.
--
-- Deliberately NOT here: price_fidelity() is called 2-6x/day with the PUBLIC key by
-- scripts/verify-detector-total-matches-its-breakdown-live.ts (af-live-truth-check.yml), so it needs that
-- caller moved to the service-role key first. audit_location_counts, refresh_mon_audit_counts and
-- sync_search_listings_ar are handled by their own migration.
--
-- CREATE OR REPLACE keeps these ACLs; a DROP + CREATE would get the schema's default grants back.

revoke execute on routine
  public.capture_crawl_stats(),
  public.loc_rel_backfill(),
  public.loc_rel_backfill_large_once(),
  public.loc_rel_nibble(text,text,integer),
  public.loc_rel_refresh(),
  public.loc_rel_refresh_one(text),
  public.loc_rel_refresh_tick(),
  public.loc_rel_upsert_table(text,bigint[]),
  public.location_pipeline_monitor(),
  public.mon_af_new_listing_readiness(),
  public.mon_detect_age_gap_alert_on_decided_source(),
  public.mon_detect_age_producer_view_drift(),
  public.mon_detect_age_resolver_platform_gap(),
  public.mon_detect_city_resolution_ignores_region(),
  public.mon_detect_cron_scheduler_frozen(),
  public.mon_detect_discarded_location_resolution(),
  public.mon_detect_district_resolution(),
  public.mon_detect_district_token_stranded(),
  public.mon_detect_dlr_lookup_equivalence(),
  public.mon_detect_english_overlay_stranded_city(),
  public.mon_detect_inactive_still_searchable(),
  public.mon_detect_index_label_unrepairable(),
  public.mon_detect_lifecycle_leak_detector_is_blind(),
  public.mon_detect_loc_rel_capacity_risk(),
  public.mon_detect_loc_rel_cycle_budget(),
  public.mon_detect_loc_rel_table_never_completes(),
  public.mon_detect_orphan_after_delete(),
  public.mon_detect_phasea_offregion_pick(),
  public.mon_detect_price_fidelity(),
  public.mon_detect_propagation_order_inverted(),
  public.mon_detect_rent_period_contract(),
  public.mon_detect_rent_period_inferred_when_source_silent(),
  public.mon_detect_search_index_diverges_from_sync_source(),
  public.mon_detect_search_index_freshness(),
  public.mon_detect_sync_pass_left_rows_unindexed(),
  public.mon_detect_v2_discards_captured_attrs(),
  public.mon_run_all_detectors(),
  public.mon_run_p0_detectors(),
  public.ops_lifecycle_orphan_after_delete(),
  public.ops_lifecycle_propagation_order_inverted(),
  public.ops_src_index_cert_run(text),
  public.propagate_dealapp_resolved_locations(),
  public.rebuild_age_producer(),
  public.resolve_english_city_overlay(),
  public.run_remediation(),
  public.search_index_freshness(),
  public.verify_platform_searchable(text)
from public, anon, authenticated;

do $$
declare f text; r text; n int := 0;
begin
  foreach f in array array[
    'public.capture_crawl_stats()', 'public.loc_rel_backfill()', 'public.loc_rel_backfill_large_once()',
    'public.loc_rel_nibble(text,text,integer)', 'public.loc_rel_refresh()', 'public.loc_rel_refresh_one(text)',
    'public.loc_rel_refresh_tick()', 'public.loc_rel_upsert_table(text,bigint[])',
    'public.location_pipeline_monitor()', 'public.mon_af_new_listing_readiness()',
    'public.mon_detect_age_gap_alert_on_decided_source()', 'public.mon_detect_age_producer_view_drift()',
    'public.mon_detect_age_resolver_platform_gap()', 'public.mon_detect_city_resolution_ignores_region()',
    'public.mon_detect_cron_scheduler_frozen()', 'public.mon_detect_discarded_location_resolution()',
    'public.mon_detect_district_resolution()', 'public.mon_detect_district_token_stranded()',
    'public.mon_detect_dlr_lookup_equivalence()', 'public.mon_detect_english_overlay_stranded_city()',
    'public.mon_detect_inactive_still_searchable()', 'public.mon_detect_index_label_unrepairable()',
    'public.mon_detect_lifecycle_leak_detector_is_blind()', 'public.mon_detect_loc_rel_capacity_risk()',
    'public.mon_detect_loc_rel_cycle_budget()', 'public.mon_detect_loc_rel_table_never_completes()',
    'public.mon_detect_orphan_after_delete()', 'public.mon_detect_phasea_offregion_pick()',
    'public.mon_detect_price_fidelity()', 'public.mon_detect_propagation_order_inverted()',
    'public.mon_detect_rent_period_contract()', 'public.mon_detect_rent_period_inferred_when_source_silent()',
    'public.mon_detect_search_index_diverges_from_sync_source()', 'public.mon_detect_search_index_freshness()',
    'public.mon_detect_sync_pass_left_rows_unindexed()', 'public.mon_detect_v2_discards_captured_attrs()',
    'public.mon_run_all_detectors()', 'public.mon_run_p0_detectors()',
    'public.ops_lifecycle_orphan_after_delete()', 'public.ops_lifecycle_propagation_order_inverted()',
    'public.ops_src_index_cert_run(text)', 'public.propagate_dealapp_resolved_locations()',
    'public.rebuild_age_producer()', 'public.resolve_english_city_overlay()', 'public.run_remediation()',
    'public.search_index_freshness()', 'public.verify_platform_searchable(text)'] loop
    n := n + 1;
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f::regprocedure, 'execute') then
        raise exception '% can still execute %', r, f;
      end if;
    end loop;
    if not has_function_privilege('service_role', f::regprocedure, 'execute') then
      raise exception 'service_role lost execute on %', f;
    end if;
  end loop;
  if n <> 47 then raise exception 'self-check covered % routines, expected 47', n; end if;
end $$;
