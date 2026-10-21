-- SECURITY PHASE 1.3 (owner-approved plan, 2026-10-20): internal views are not a public API.
--
-- 39 views/materialized views were SELECT-able with the publishable key. Views run with their OWNER's rights (none of
-- these is security_invoker), so each one bypassed row security on what it reads: ops dashboards, the engineer alert
-- queue, scraper heartbeat, crawl stats, AI costs, liveness outcomes, kill lists — business intelligence for anyone.
--
-- Kept public on purpose (measured 2026-10-20):
--   listing_location_canonical_mv, listing_location_index, location_index, location_index_live — read by the app (src/);
--   ops_platform_liveness_coverage — read with the public key by the live check verify-liveness-claims-are-earned.ts.
-- None of the 34 below is read by src/, api/ or middleware.ts, and no search RPC reads them (only four internal helper
-- functions do). Owner-run jobs (pg_cron, SECURITY DEFINER detectors) and service_role tooling are unaffected.
--
-- Rollback: grant select on <view> to anon, authenticated;
do $mig$
declare
  v text;
  views text[] := array[
    'active_listing_ids', 'active_listing_ids_v2', 'af_coverage_active_only', 'ai_usage_costed',
    'buy_location_index', 'city_listing_counts_ar', 'crawl_stats_daily', 'crawl_stats_platform_daily',
    'listing_age_resolved', 'listing_extra_attrs', 'listing_extra_attrs_mv', 'listing_extra_attrs_v0',
    'listing_extra_attrs_v1', 'listing_location_canonical', 'listing_native_location_v1', 'listing_native_location_v2',
    'listing_rich_attrs', 'listing_source_district_ar', 'loader_scale_stats_total_mv', 'location_index_ar',
    'location_review', 'monitoring_dashboard', 'ops_active_claims', 'ops_adjudicated_listing',
    'ops_aqar_recent_kills', 'ops_dealapp_liveness_outcomes', 'ops_engineer_alert_queue', 'ops_freshness_by_layer',
    'owner_price_source_shows_small_total', 'phasea_shadow_resolution', 'platforms_deprecated_status',
    'platforms_unsearchable', 'rent_location_index', 'scraper_heartbeat'
  ];
begin
  foreach v in array views loop
    execute format('revoke all on public.%I from anon, authenticated', v);
    execute format('grant select on public.%I to service_role', v);
  end loop;
end
$mig$;
