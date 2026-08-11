-- A priced Rent listing with no rent period is reachable by NEITHER the annual nor the monthly
-- Filter. It sits in search_listings_ar looking healthy, it is counted as searchable by every
-- count-parity check, and the only way a user ever sees it is by leaving the period chip unset.
--
-- mon_source_is_truth_violations() has carried this check ("rent_period_missing_on_priced_rent")
-- since it was written, but NOTHING CALLS THAT FUNCTION — it is a manual barrier. Verified
-- 2026-08-11: no pg_proc body other than its own references it, so 77 unreachable priced rent
-- listings had never raised a single alert. Per AGENTS.md §11a a barrier nothing reaches is
-- decoration; this wires the check to the roster so it can page.
--
-- Known population at ship time (2026-08-11): aqar 75 (64 residential + 11 commercial) + october 1.
-- The aqar cohort is a PROVEN Ezhalah-side defect, not a source limitation: those rows carry the
-- June `backfill.v1` stub capture whose missing «تفاصيل الإعلان» block means every label-anchored
-- parser reads nothing, while aqar itself publishes «سنوي» (scrapers/aqar/recover_stubs.py, which
-- exists for exactly this). They are being re-enriched separately. Nothing here writes listing data.
create or replace function public.mon_detect_rent_period_unreachable()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  total bigint;
  by_platform jsonb;
  n int := 0;
begin
  select count(*), coalesce(jsonb_object_agg(platform, c), '{}'::jsonb)
    into total, by_platform
  from (
    select platform, count(*) c
    from public.search_listings_ar
    where deal_ar = 'إيجار'
      and (price_annual is not null or price_total is not null)
      and (rent_period_ar is null or rent_period_ar not in ('سنوي','شهري'))
    group by platform
  ) s, lateral (select 1) _;

  -- recompute the scalar honestly (the aggregate above counts platforms, not rows)
  select coalesce(sum(c), 0) into total from (
    select count(*) c from public.search_listings_ar
    where deal_ar = 'إيجار'
      and (price_annual is not null or price_total is not null)
      and (rent_period_ar is null or rent_period_ar not in ('سنوي','شهري'))
    group by platform
  ) t(c);

  if total > 0 then
    n := public.mon_raise('P2', 'rent_period_unreachable', 'all',
      'rent_period_unreachable',
      jsonb_build_object(
        'unreachable_priced_rent_rows', total,
        'by_platform', by_platform,
        'why', 'Priced Rent listings whose rent_period_ar is neither «سنوي» nor «شهري». They are '
               'in search_listings_ar and counted as searchable, but the annual and monthly Filter '
               'branches both exclude them — a user only reaches them with no period chip set. '
               'Do NOT fix by defaulting the period: that would invent a source fact. Re-enrich the '
               'row so the period comes from the platform (aqar: scrapers/aqar/recover_stubs.py), '
               'or confirm the source genuinely publishes no period and record it.'));
  else
    perform public.mon_resolve_key('rent_period_unreachable');
  end if;

  return n;
end $function$;

-- ── roster entry, SAME migration (AGENTS.md §11a: a detector outside the roster is decoration) ──
-- Body copied verbatim from the LIVE pg_get_functiondef read at 2026-08-11 07:37Z, with exactly one
-- array element added. The recorded failure mode here is a hand-retyped body silently dropping
-- entries (at least four losses: 20260804113911, 20260810175245, 20260810202219) — the DO block
-- below asserts every one of the 32 pre-existing detectors survived, so that cannot happen silently.
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
    'mon_detect_price_eq_area_or_ppm',      -- new 2026-08-10: area/ppm-as-price artifact tripwire
    'mon_detect_price_size_contamination',
    'mon_detect_trending_district_dead_end',
    'mon_detect_location_predicate_drift',
    'mon_detect_search_performance_regression',
    'mon_detect_commercial_coverage_blind_spot',
    'mon_detect_stalled_daily_detector',
    'mon_detect_zero_price_served',
    'mon_detect_filter_barrier_leaks',
    'mon_detect_deploy_lock_misuse',
    'mon_detect_rent_period_unreachable',   -- new 2026-08-11: priced rent unreachable by both periods
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
  return result || jsonb_build_object('ran_at', now(), 'failed', to_jsonb(failed),
    'open_alerts', (select coalesce(jsonb_object_agg(severity, c), '{}'::jsonb)
                       from (select severity, count(*) c from public.alert_event
                              where resolved_at is null group by severity) s));
end $function$;

do $$
declare
  body text := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  survivors constant text[] := array[
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
    'mon_detect_orphaned_detectors'
  ];
  f text;
begin
  -- 1. no pre-existing detector was dropped by this rewrite
  foreach f in array survivors loop
    if position(f in body) = 0 then
      raise exception 'roster regression: % was dropped from mon_run_all_detectors', f;
    end if;
  end loop;

  -- 2. the new detector is actually wired
  if position('mon_detect_rent_period_unreachable' in body) = 0 then
    raise exception 'mon_detect_rent_period_unreachable was not wired into the roster';
  end if;

  -- 3. it runs without crashing
  perform public.mon_detect_rent_period_unreachable();

  raise notice 'rent_period_unreachable barrier wired; % detectors in roster', array_length(survivors,1) + 1;
end $$;
