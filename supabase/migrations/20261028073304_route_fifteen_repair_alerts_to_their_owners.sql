-- Fifteen alerts in 🔧 Repair's queue belong to another engineer by the team's own ownership map (owner 2026-10-28:
-- «go» — help Repair). docs/ops/ADVANCED_FILTER_ENGINEER.md «Who does what»: 🔬 owns every Advanced Filter field on
-- listings older than 24h (furnished, age, amenities, unit sub-types …); ♻️ owns dead/alive; ⚡ owns crawls finishing.
-- district_copies_unlisted, district_near_twins_served and place_list_leaks are named in NEW_LISTINGS_ENGINEER.md.
-- Everything else stays with 🔧, which by that same map «owns everything nobody else does».
create or replace function public.ops_engineer_for_alert(p_kind text, p_owner_routine text)
 returns text
 language sql
 immutable
as $function$
  select case
    when p_kind ~ '^(zero_new_stall|af_new_listing_capture_regression|district_contradicts_source|district_copies_unlisted|district_near_twins_served|place_list_leaks)$' then 'new_listings_engineer'
    when p_kind ~ '^(fabricated_unpublished_amenity|not_installed_served_as_yes|gathern_manufactured_no|age_open_bucket_stored_as_precise|age_resolver_platform_gap|filter_parity_legacy|sadiqeltajer_af_outside_room_list)$' then 'advanced_filter'
    when p_kind ~ '^(wasalt_dead_but_active|dealapp_unsafe_deactivation)$' then 'lifecycle'
    when p_kind ~ '^(scrape_suspect|source_shows_small_total)$' then 'scraping-engineer'
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
  if public.ops_engineer_for_alert('place_list_leaks', 'routine-3-data-integrity') <> 'new_listings_engineer'
     or public.ops_engineer_for_alert('not_installed_served_as_yes', 'routine-3-data-integrity') <> 'advanced_filter'
     or public.ops_engineer_for_alert('wasalt_dead_but_active', 'routine-7-seam') <> 'lifecycle'
     or public.ops_engineer_for_alert('scrape_suspect', 'routine-3-data-integrity') <> 'scraping-engineer' then
    raise exception 'PROOF: a moved kind is not on its new route';
  end if;
  if public.ops_engineer_for_alert('district_contradicts_source', 'routine-3-data-integrity') <> 'new_listings_engineer'
     or public.ops_engineer_for_alert('located_row_unreachable', 'routine-3-data-integrity') <> 'repair'
     or public.ops_engineer_for_alert('price_drift', 'routine-3-data-integrity') <> 'repair'
     or public.ops_engineer_for_alert('stale_no_remediation_path', 'routine-7-seam') <> 'repair'
     or public.ops_engineer_for_alert('anything_else', 'routine-1-scraping') <> 'scraping-engineer' then
    raise exception 'PROOF: a kind that should not move changed route';
  end if;
  raise notice 'PROOF OK: 14 kinds moved off repair; every other route unchanged';
end $proof$;