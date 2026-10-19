-- 🔧 Quality & Repair 2026-10-11, follow-up to 20261011132418 (ops_engineer_for_alert): read against the
-- live queue, three kinds about a dead or wrongly revived listing still reaching a customer landed on
-- 'repair' through the legacy-owner fallback; they are ♻️ lifecycle's surface by definition
-- (QUALITY_REPAIR_ENGINEER.md: «a listing deleted on its website disappears from ours»):
--   served_despite_direct_404 (1 open), stale_active (3 open), adjudicated_reactivation (1 open).
-- Same function, one alternation extended; the self-test proves the three and re-proves totality.

create or replace function public.ops_engineer_for_alert(p_kind text, p_owner_routine text)
returns text
language sql
immutable
as $$
  select case
    when p_kind ~ '^(zero_new_stall|af_new_listing_capture_regression)$' then 'new_listings_engineer'
    when p_kind ~ '^(silent_scraper_death|silent_partial_success|run_|dangling_scrape_run|proxy_|scraper_|enumeration_incomplete|legacy_scraper_freshness|dealapp_shard|aqar_deep_fill_health|wasalt_enrich|summary_only_capture|unattributable_platform_runs|liveness_cap_degraded|source_limited_contradicted|unprobed_source_waiver|ingestion_check_failed|moj_district_sales_stale)' then 'scraping-engineer'
    when p_kind ~ '^(served_after_source_gone|deleted_but_source_live|unledgered_hard_delete|liveness_|lifecycle_|gathern_liveness|oracle_chain_never_observed|deletion_|inactive_still|false_resurrection|unknown_treated_as_dead|orphan_after_delete|stale_listings_detected|stale_breaker_escape|stale_active|served_despite_direct_404|adjudicated_reactivation|quarantine_growth|prune_|cleanup_evidence_gap|deletion_spike|mass_inactivation|unverified_inactivation|inactivation)' then 'lifecycle'
    when p_kind ~ '^(af_|monthly_af|trending_)' then 'advanced_filter'
    when p_owner_routine = 'routine-1-scraping'    then 'scraping-engineer'
    when p_owner_routine = 'routine-5-af-trending' then 'advanced_filter'
    when p_owner_routine = 'routine-11-lifecycle'  then 'lifecycle'
    else 'repair'
  end
$$;

do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.ops_engineer_alert_queue
   where engineer is null
      or engineer not in ('scraping-engineer','new_listings_engineer','advanced_filter','lifecycle','repair');
  if v_bad > 0 then raise exception 'ops_engineer_for_alert is not total: % open alerts without a live engineer', v_bad; end if;
  if public.ops_engineer_for_alert('served_despite_direct_404', 'routine-3-data-integrity') <> 'lifecycle'
     or public.ops_engineer_for_alert('stale_active', 'routine-3-data-integrity') <> 'lifecycle'
     or public.ops_engineer_for_alert('adjudicated_reactivation', 'routine-3-data-integrity') <> 'lifecycle'
     or public.ops_engineer_for_alert('stale_no_remediation_path', 'routine-7-seam') <> 'repair'
     or public.ops_engineer_for_alert('district_contradicts_source', 'routine-3-data-integrity') <> 'repair'
  then raise exception 'ops_engineer_for_alert disagrees with the rules this migration states'; end if;
end $$;