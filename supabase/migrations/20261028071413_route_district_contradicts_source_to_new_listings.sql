-- district_contradicts_source belongs to 🆕 New Listings, not 🔧 Repair (owner 2026-10-28: «lets give those to the engineers»).
-- docs/ops/NEW_LISTINGS_ENGINEER.md (🦅 Falcon 10-09) says of this exact alert «the hourly P1 district_contradicts_source
-- alert is the robot — own it», and its source table lists mon_detect_district_contradicts_source as one of its oracles.
-- Yet ops_engineer_for_alert sent it to 'repair' through the legacy routine-3 fallback: 39 open P1s sat in the Repair
-- queue (304 items, the longest by far) while the engineer that owns them never read them. Only this kind moves; every
-- other kind keeps its route.
create or replace function public.ops_engineer_for_alert(p_kind text, p_owner_routine text)
 returns text
 language sql
 immutable
as $function$
  select case
    when p_kind ~ '^(zero_new_stall|af_new_listing_capture_regression|district_contradicts_source)$' then 'new_listings_engineer'
    when p_kind ~ '^(silent_scraper_death|silent_partial_success|run_|dangling_scrape_run|proxy_|scraper_|enumeration_incomplete|legacy_scraper_freshness|dealapp_shard|aqar_deep_fill_health|wasalt_enrich|summary_only_capture|unattributable_platform_runs|liveness_cap_degraded|source_limited_contradicted|unprobed_source_waiver|ingestion_check_failed|moj_district_sales_stale)' then 'scraping-engineer'
    when p_kind ~ '^(served_after_source_gone|deleted_but_source_live|unledgered_hard_delete|liveness_|lifecycle_|gathern_liveness|oracle_chain_never_observed|deletion_|inactive_still|false_resurrection|unknown_treated_as_dead|orphan_after_delete|stale_listings_detected|stale_breaker_escape|stale_active|served_despite_direct_404|adjudicated_reactivation|quarantine_growth|prune_|cleanup_evidence_gap|deletion_spike|mass_inactivation|unverified_inactivation|inactivation)' then 'lifecycle'
    when p_kind ~ '^(af_|monthly_af|trending_)' then 'advanced_filter'
    when p_owner_routine = 'routine-1-scraping'    then 'scraping-engineer'
    when p_owner_routine = 'routine-5-af-trending' then 'advanced_filter'
    when p_owner_routine = 'routine-11-lifecycle'  then 'lifecycle'
    else 'repair'
  end
$function$;

do $proof$
begin
  if public.ops_engineer_for_alert('district_contradicts_source', 'routine-3-data-integrity') <> 'new_listings_engineer' then
    raise exception 'PROOF: district_contradicts_source is not routed to new_listings_engineer';
  end if;
  if public.ops_engineer_for_alert('located_row_unreachable', 'routine-3-data-integrity') <> 'repair'
     or public.ops_engineer_for_alert('zero_new_stall', null) <> 'new_listings_engineer'
     or public.ops_engineer_for_alert('stale_no_remediation_path', 'routine-7-seam') <> 'repair'
     or public.ops_engineer_for_alert('anything_else', 'routine-1-scraping') <> 'scraping-engineer' then
    raise exception 'PROOF: another kind changed route';
  end if;
  raise notice 'PROOF OK: district_contradicts_source → new_listings_engineer; every other route unchanged';
end $proof$;