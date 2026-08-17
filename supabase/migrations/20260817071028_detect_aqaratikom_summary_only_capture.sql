-- Senior run #25 (2026-08-17). Regression protection for a silent capture-loss class found today.
--
-- WHAT HAPPENED: aqaratikom (nawait.sa) builds each row from TWO calls — POST /api/v1/ad (summary:
-- price, area, category, city, media) and GET /api/v1/ad/<uuid> (detail: estate.details[] carrying
-- عدد دورة المياه, عدد الصالات, عرض الشارع, واجهة العقار, مصعد, مطبخ, plus `subtype` = the rent
-- period). When fetch_detail() returns None, map_listing() STILL emits a row from the summary alone,
-- the upsert stores it, and end_run() reports ok=true. The run looks perfectly healthy while every
-- detail-only field is silently dropped — the exact "silent partial crawl" the audit routine §3
-- requires us to detect, and §10's "nothing supported should be silently dropped".
--
-- EVIDENCE (run #25): 8 searchable Rent apartments carried price+area but NULL rent_period, so
-- neither period chip could reach them (searchability_collapse:aqaratikom, 100% -> 82.6%). A live
-- probe of all 8 via the scraper's OWN detail endpoint returned HTTP 200 with subtype=«سنوي» and a
-- price matching the stored value exactly — so the source DOES publish the period and the NULL was
-- OURS, not the source's (owner permanent rule #2: absence is not evidence of source silence).
-- The discriminator that proved the mechanism: those 8 rows had 0/8 bathrooms, 0/8 halls, 0/8 street
-- width, 0/8 direction, 0/8 elevator, while the healthy cohort ran 42-53/55 on the same fields —
-- i.e. the whole detail record was missing, not just the period. 24 of 132 active rows are affected.
--
-- WHY A DETECTOR AND NOT JUST THE PARSER FIX: this alert already flapped once (resolved 2026-08-13,
-- raised again 2026-08-17), so the condition recurs. searchability_collapse only sees the RENT
-- period symptom; it is blind to a Buy row that lost its bathrooms and street width, which is an
-- Advanced Filter reachability loss with no other monitor.
--
-- Scoped deliberately to aqaratikom: this platform's detail endpoint is PROVEN to publish these
-- fields, so their simultaneous absence is a capture failure. Other platforms legitimately omit
-- them, and a generic version would be a false-positive generator (§31: a real source limitation
-- must not count as a scraper bug).
create or replace function public.mon_detect_summary_only_capture()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_cnt bigint; v_total bigint; v_open boolean; n int := 0;
begin
  -- Summary-only = the summary-derived fields are present (so the crawl reached the platform) while
  -- EVERY detail-only field is null at once. Requiring all six together is what keeps an ordinary
  -- sparse ad (a seller who simply listed no lift) out of this count.
  select count(*) filter (where area_m2 is not null
                            and bathrooms is null and halls is null and street_width_m is null
                            and direction is null and elevator is null and kitchen is null),
         count(*)
    into v_cnt, v_total
    from public.aqaratikom_residential_listings
   where active;

  v_open := exists (select 1 from public.alert_event
                     where dedup_key = 'summary_only_capture:aqaratikom' and resolved_at is null);

  if v_cnt = 0 then
    if v_open then perform public.mon_resolve('summary_only_capture', 'aqaratikom'); end if;
  elsif not v_open then
    n := n + public.mon_raise('P2', 'summary_only_capture', 'aqaratikom',
      'summary_only_capture:aqaratikom',
      jsonb_build_object(
        'rows', v_cnt, 'active_total', v_total,
        'frac', round((v_cnt::numeric / greatest(v_total,1)), 3),
        'why', 'These active rows carry summary fields (price/area) but NOT ONE detail-only field '
            || '(bathrooms, halls, street width, direction, elevator, kitchen). nawait.sa serves '
            || 'those only from GET /api/v1/ad/<uuid>, so the detail fetch returned nothing and the '
            || 'row was built from the summary alone — while the scrape run still reported ok=true. '
            || 'Rent rows in this state also lose `subtype`, the rent period, and fall out of BOTH '
            || 'period chips.',
        'adjudicate', 'Do NOT default a rent period or invent an attribute to clear this (§22 — that '
            || 'fabricates a source fact). Re-probe GET /api/v1/ad/<uuid> for a sample: if it '
            || 'returns 200 with estate.details[], the loss is OURS and the fix belongs in the '
            || 'scraper''s fetch_detail path; the rows then refill on the next successful crawl '
            || 'because the upsert preserves known-over-unknown. Record probes in '
            || 'ops_rent_period_source_probe.'));
  end if;
  return n;
end $function$;

-- Roster entry in the SAME migration (AGENTS.md): mon_detect_orphaned_detectors() fires on any
-- detector nothing reaches, and a detector outside the roster is decoration.
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
    'mon_detect_wasalt_annualisation_fabricated',
    'mon_detect_source_limited_contradicted',
    'mon_detect_search_performance_regression',
    'mon_detect_commercial_coverage_blind_spot',
    'mon_detect_rent_period_contradicts_capture',
    'mon_detect_served_after_source_confirmed_gone',
    'mon_detect_search_index_diverges_from_sync_source',
    'mon_detect_priceless_rent_with_labelled_source_price',
    'mon_detect_rent_period_contradicts_probe',
    'mon_detect_unresolvable_detector',
    'mon_detect_liveness_cap_degraded',
    'mon_detect_summary_only_capture',
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
