-- ROSTER REPAIR (2026-08-10, same session): my cron_stampede migration rebuilt mon_run_all_detectors
-- from the stale 20260804120000 shape and DROPPED 3 detectors added by 20260808062049
-- (buy_token_price_suppression, price_source_mismatch, dangling_scrape_run). Caught minutes later by
-- comparing the live fns array against every mon_detect_* function. ALSO: 20260808062049 itself had
-- silently dropped mon_detect_search_gate_leak (added 20260804063424) — the same stale-base-paste
-- accident. This is the UNION roster: 08-08's 21 + search_gate_leak restored + cron_minute_collision.
-- Detectors intentionally NOT here run on their own cron jobs: price_fidelity(42),
-- district_resolution(43), wasalt_enrich_backlog(40), aqar_ppm_as_total(63), refresh_coverage(58),
-- price_magnitude_gate(59); filter_barrier via mon_check_normal_filter_barrier(64).
-- NOTE: superseded minutes later by 20260810175327 — search_gate_leak turned out to no longer EXIST
-- (legitimately superseded by the filter-barrier monitor). Kept verbatim for history fidelity.
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
    'mon_detect_search_gate_leak',            -- restored (silently dropped by 20260808062049)
    'mon_detect_buy_token_price_suppression', -- from 20260808062049
    'mon_detect_price_source_mismatch',       -- from 20260808062049
    'mon_detect_dangling_scrape_run',         -- from 20260808062049
    'mon_detect_cron_minute_collision',       -- new 2026-08-10: cron-stampede tripwire (522 incident)
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
  return result || jsonb_build_object('ran_at', now(), 'failed', to_jsonb(failed));
end $function$;
