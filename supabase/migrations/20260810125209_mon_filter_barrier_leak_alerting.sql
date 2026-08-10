-- Detector: any nonzero leak in mon_filter_barrier_leaks = a bad row reachable by the normal Filter = P1.
CREATE OR REPLACE FUNCTION public.mon_detect_filter_barrier_leaks()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
declare r record; total_leaks bigint; v_open_sev text; n int := 0;
begin
  select * into r from public.mon_filter_barrier_leaks;
  total_leaks := coalesce(r.leak_impossible_price_size,0) + coalesce(r.leak_no_city,0)
               + coalesce(r.leak_no_region,0) + coalesce(r.leak_no_deal,0)
               + coalesce(r.leak_negative_area,0) + coalesce(r.leak_negative_price,0);
  select severity into v_open_sev from public.alert_event
    where dedup_key='filter_barrier_leak' and resolved_at is null order by created_at desc limit 1;
  if total_leaks = 0 then
    if v_open_sev is not null then perform public.mon_resolve('filter_barrier_leak','filter_barrier'); end if;
  elsif v_open_sev is distinct from 'P1' then
    if v_open_sev is not null then perform public.mon_resolve('filter_barrier_leak','filter_barrier'); end if;
    n := n + public.mon_raise('P1','filter_barrier_leak','filter_barrier','filter_barrier_leak',
      to_jsonb(r) || jsonb_build_object('why',
        'A production_ready row is reachable by the normal Filter while violating a hard barrier '
        '(missing location/deal, negative/impossible price or size, or the impossible-price-size gate). '
        'Bad data can reach users. Does NOT include source-price magnitude (never hidden). '
        'Investigate the write path and production_ready state.'));
  end if;
  return n;
end $fn$;

-- Wire it into the master detector orchestrator (append to the fns array).
CREATE OR REPLACE FUNCTION public.mon_run_all_detectors()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  fns text[] := array[
    'mon_detect_silent_scraper_death','mon_detect_zero_new_stall','mon_detect_stale_active_fraction',
    'mon_detect_volume_drop','mon_detect_cron_health','mon_detect_stale_refresh',
    'mon_detect_legacy_alert_tables','mon_detect_field_integrity','mon_detect_search_index_freshness',
    'mon_detect_quarantine_growth','mon_detect_registry_orphans','mon_detect_rls_reachability',
    'mon_detect_mass_inactivation','mon_detect_english_district_leak','mon_detect_impossible_price_size',
    'mon_detect_unverified_inactivation','mon_detect_deletion_spike','mon_detect_buy_token_price_suppression',
    'mon_detect_price_source_mismatch','mon_detect_dangling_scrape_run','mon_detect_zero_price_served',
    'mon_detect_orphaned_detectors','mon_detect_filter_barrier_leaks'
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
      exception when others then null;
      end;
    end;
  end loop;
  return result || jsonb_build_object('ran_at', now(), 'failed', to_jsonb(failed));
end $function$;