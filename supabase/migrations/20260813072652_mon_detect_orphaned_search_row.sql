-- Data Integrity Engineer run #16 (2026-08-13).
-- Invariant: every row in search_listings_ar must be reachable by AT LEAST ONE Normal Filter
-- combination. location_search_candidates_ar admits a row via exactly two branches:
--   (a) s.production_ready, or
--   (b) the unlocated fallback, which REQUIRES (s.region_id is null or s.city_id is null).
-- A row that is production_ready=false while carrying BOTH region_id and city_id therefore
-- satisfies neither branch and is retrievable by no filter at all — it sits in the index and
-- counts as "searchable" in every count-parity check while no user can ever reach it.
-- Same shape as §22's rent-period cohort and §11a's decorative barriers.
--
-- The 24 rows in this state on 2026-08-13 are ALL price_size_impossible (trg_price_size_sanity
-- downgrades production_ready), which is the already-open price_gate_withheld P2 and an owner
-- policy question — not a new defect. Alerting on them daily would make this detector red
-- forever, and a barrier that is always red carries no information (run #8's lesson). So the
-- gate cohort is excluded and this fires only when a row becomes unreachable for a NEW reason.
create or replace function public.mon_detect_orphaned_search_row()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; cnt int; sample jsonb;
begin
  select count(*) into cnt
    from public.search_listings_ar s
   where not s.production_ready
     and s.region_id is not null
     and s.city_id  is not null
     and not public.price_size_impossible(s.price_total, s.price_annual, s.area_m2);

  if coalesce(cnt, 0) > 0 then
    select jsonb_agg(x) into sample from (
      select s.source_table, s.listing_id, s.platform, s.city_ar, s.deal_ar, s.type_ar
        from public.search_listings_ar s
       where not s.production_ready
         and s.region_id is not null
         and s.city_id  is not null
         and not public.price_size_impossible(s.price_total, s.price_annual, s.area_m2)
       order by s.source_table, s.listing_id
       limit 20) x;

    n := public.mon_raise('P1', 'orphaned_search_row', 'all', 'orphaned_search_row',
      jsonb_build_object(
        'count', cnt,
        'sample', sample,
        'why', 'Rows in search_listings_ar with a COMPLETE canonical location (region_id and city_id both set) but production_ready=false. They fail both branches of location_search_candidates_ar — the unlocated fallback admits only rows whose region_id or city_id IS NULL — so NO filter combination returns them, yet they still count as searchable in table-vs-index parity. The price/size-gate cohort is deliberately excluded from this count, so a non-zero value here is a NEW cause. Find why production_ready was cleared on a fully located row; do NOT fix it by flipping production_ready without establishing that cause.'));
  else
    perform public.mon_resolve_key('orphaned_search_row', 'orphaned_search_row');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_orphaned_search_row() is
'Data Integrity run #16 (2026-08-13). Asserts every search_listings_ar row is reachable by at least one Normal Filter path. Excludes the price_size_impossible cohort (24 rows on 2026-08-13, already tracked by price_gate_withheld / location_pipeline_monitor and pending an owner decision) so the detector stays green and fires only on a new cause.';

-- §11a: a barrier nothing calls is decoration — the roster entry lands in the SAME migration.
create or replace function public.mon_run_all_detectors()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  fns text[] := array[
    'mon_detect_silent_scraper_death','mon_detect_zero_new_stall','mon_detect_stale_active_fraction',
    'mon_detect_volume_drop','mon_detect_cron_health','mon_detect_stale_refresh',
    'mon_detect_legacy_alert_tables','mon_detect_field_integrity','mon_detect_search_index_freshness',
    'mon_detect_quarantine_growth','mon_detect_registry_orphans','mon_detect_rls_reachability',
    'mon_detect_mass_inactivation','mon_detect_english_district_leak','mon_detect_impossible_price_size',
    'mon_detect_unverified_inactivation','mon_detect_deletion_spike',
    'mon_detect_buy_token_price_suppression','mon_detect_price_source_mismatch',
    'mon_detect_dangling_scrape_run','mon_detect_cron_minute_collision','mon_detect_price_eq_area_or_ppm',
    'mon_detect_price_size_contamination','mon_detect_trending_district_dead_end',
    'mon_detect_location_predicate_drift','mon_detect_search_performance_regression',
    'mon_detect_commercial_coverage_blind_spot','mon_detect_stalled_daily_detector',
    'mon_detect_zero_price_served','mon_detect_filter_barrier_leaks','mon_detect_deploy_lock_misuse',
    'mon_detect_rent_period_unreachable','mon_detect_manufactured_rent_period',
    'mon_detect_alert_delivery','mon_detect_sql_mirror_drift',
    'mon_detect_dealapp_shard_coverage',   -- new 2026-08-11: 12-shard fleet coverage/partition
        'mon_detect_rent_period_source_mismatch',
    'mon_detect_searchability_collapse',
    'mon_detect_served_after_source_confirmed_gone',
    'mon_detect_url_collisions_res_vs_com',
    'mon_detect_orphaned_detectors', 'mon_detect_rent_period_contradicts_capture', 'mon_detect_unsortable_served_listing', 'mon_detect_priceless_rent_with_labelled_source_price',
    'mon_detect_loc_rel_capacity_risk',   -- new 2026-08-12: dealapp cron-timeout incident, GH #505
    'mon_detect_orphaned_search_row'      -- new 2026-08-13: indexed but reachable by no Filter path
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
  return result || jsonb_build_object('ran_at', now(), 'failed', to_jsonb(failed),
    'open_alerts', (select coalesce(jsonb_object_agg(severity, c), '{}'::jsonb)
                       from (select severity, count(*) c from public.alert_event
                              where resolved_at is null group by severity) s));
end $function$;
