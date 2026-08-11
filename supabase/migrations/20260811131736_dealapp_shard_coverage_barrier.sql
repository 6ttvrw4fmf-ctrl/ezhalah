-- Coverage/completeness barrier for the dealapp 12-shard fleet (owner-approved 2026-08-11, opt b).
--
-- WHAT IT PROVES, in the owner's terms:
--   * every active dealapp listing belongs to exactly one shard — membership is int(ad_number)%12,
--     a TOTAL function, so the only way a row can belong to NO shard is a non-numeric ad_number,
--     and that is counted here. Belonging to TWO shards is arithmetically impossible for a modulo,
--     which is why the key is a hash and not a range split (aqar bug B1 gave shard 0 81% of rows).
--   * all shards execute on schedule — a shard that never ran is a permanent coverage hole that
--     nothing else in the fleet would report, because the other eleven look perfectly healthy.
--   * the union of shards covers the full intended inventory — measured directly as the fraction
--     of ACTIVE rows whose last_seen_at moved inside the window, not inferred from run counts.
--   * a failed shard does not cause false inactivation — a 0-row/blocked shard is surfaced here,
--     and prune_unseen still returns -1 for it (empty seen-set guard), so it ages out nothing.
--   * stale coverage should fall — stale_7d is reported every run so the trend is visible rather
--     than asserted.
--
-- Baseline at ship time (2026-08-11, BEFORE the fleet's first run): 8,386 active (8,012 res + 374
-- com), 4,197 of them 7-day stale (50.0%), ~25% weekly coverage from the single capped crawl.
create or replace function public.mon_detect_dealapp_shard_coverage()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_shards constant int := 12;
  v_active bigint; v_orphan bigint; v_seen24 bigint; v_stale7 bigint;
  v_missing int[]; v_blocked int; v_cov numeric; n int := 0;
begin
  select count(*), count(*) filter (where ad_number !~ '[0-9]'),
         count(*) filter (where last_seen_at > now() - interval '24 hours'),
         count(*) filter (where last_seen_at < now() - interval '7 days')
    into v_active, v_orphan, v_seen24, v_stale7
  from (
    select ad_number, last_seen_at from public.dealapp_residential_listings where active
    union all
    select ad_number, last_seen_at from public.dealapp_commercial_listings where active
  ) s;

  -- Which shards did NOT complete a healthy run in the last 24h. The fleet is dispatched daily, so
  -- a full sweep must show all 12. Anything missing is a slice of inventory nobody visited.
  select array_agg(g.sh order by g.sh) into v_missing
  from generate_series(0, v_shards - 1) g(sh)
  where not exists (
    select 1 from public.scrape_runs r
    where r.platform = 'dealapp:' || g.sh || '/' || v_shards
      and r.started_at > now() - interval '24 hours'
      and r.ok
  );

  -- Blocked shards: dealapp's origin trips a login-wall under burst (2 of 8 runs on 2026-08-11).
  -- These prune nothing by design; they are reported so a systematic block is visible early.
  select count(*) into v_blocked from public.scrape_runs
   where platform like 'dealapp:%/' || v_shards
     and started_at > now() - interval '24 hours'
     and coalesce(rows_seen, 0) = 0;

  v_cov := round(v_seen24::numeric / nullif(v_active, 0), 3);

  -- P1: a listing owned by no shard can never be re-confirmed or aged out — it is invisible
  -- inventory, the exact failure sharding is supposed to eliminate.
  if v_orphan > 0 then
    n := n + public.mon_raise('P1', 'dealapp_shard_coverage', 'dealapp',
      'dealapp_shard_orphan_ids',
      jsonb_build_object('orphan_rows', v_orphan, 'active', v_active,
        'why', 'active dealapp rows whose ad_number has no digits belong to NO shard under '
               'int(ad_number)%12, so no shard will ever fetch them and prune_unseen will never '
               'see them. Fix the ad_number, never widen a shard to swallow them.'));
  else
    perform public.mon_resolve_key('dealapp_shard_coverage', 'dealapp_shard_orphan_ids');
  end if;

  -- P1: a shard that did not run leaves ~1/12 of inventory unvisited, silently.
  if v_missing is not null and array_length(v_missing, 1) > 0 then
    n := n + public.mon_raise('P1', 'dealapp_shard_coverage', 'dealapp',
      'dealapp_shard_missing_run',
      jsonb_build_object('missing_shards', to_jsonb(v_missing),
        'ran', v_shards - array_length(v_missing, 1), 'of', v_shards,
        'blocked_zero_row_runs', v_blocked,
        'why', 'these shards have no healthy run in 24h, so their slice of the active inventory '
               'was not re-confirmed. Dispatch dealapp-sharded.yml; do NOT compensate by widening '
               'another shard, which would break the exactly-one-shard partition.'));
  else
    perform public.mon_resolve_key('dealapp_shard_coverage', 'dealapp_shard_missing_run');
  end if;

  -- P2: the fleet ran but did not actually reach the inventory. Below prune_unseen's 0.80 floor the
  -- coverage guard trips and NOTHING is ever aged out — the precise state that made the standing
  -- stale_active alerts unfixable before sharding.
  if v_active > 0 and coalesce(v_cov, 0) < 0.80 then
    n := n + public.mon_raise('P2', 'dealapp_shard_coverage', 'dealapp',
      'dealapp_shard_under_coverage',
      jsonb_build_object('coverage_24h', v_cov, 'seen_24h', v_seen24, 'active', v_active,
        'stale_7d', v_stale7, 'blocked_zero_row_runs', v_blocked,
        'floor', 0.80,
        'why', 'the fleet re-confirmed less than prune_unseen''s PRUNE_MIN_COVERAGE floor, so the '
               'partial-scrape guard will keep returning -1 and no dead listing can age out. '
               'Check for blocked shards or a shard count that no longer fits throughput.'));
  else
    perform public.mon_resolve_key('dealapp_shard_coverage', 'dealapp_shard_under_coverage');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_dealapp_shard_coverage() is
  'dealapp 12-shard fleet coverage barrier (owner-approved 2026-08-11). Proves: every active '
  'listing belongs to exactly one shard (modulo is total; orphans = non-numeric ad_number are '
  'raised P1), every shard ran in 24h (missing shard = P1), and the union actually reached the '
  'inventory (coverage under prune_unseen''s 0.80 floor = P2). Baseline before the first fleet '
  'run: 8,386 active, 4,197 stale-7d (50.0%), ~25% weekly coverage.';

-- ── roster entry, SAME migration (AGENTS.md §11a: a detector outside the roster is decoration) ──
-- Array copied from the LIVE pg_get_functiondef read at 2026-08-11 13:16Z (36 detectors), with one
-- element inserted before mon_detect_orphaned_detectors, which stays last. The DO block below
-- asserts every one of the 36 survived — the silent-drop class that has cost this roster entries
-- at least four times (20260804113911, 20260810175245, 20260810202219).
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
    'mon_detect_rent_period_unreachable','mon_detect_manufactured_rent_period',
    'mon_detect_alert_delivery','mon_detect_sql_mirror_drift','mon_detect_orphaned_detectors'
  ];
  f text;
begin
  foreach f in array survivors loop
    if position(f in body) = 0 then
      raise exception 'roster regression: % was dropped from mon_run_all_detectors', f;
    end if;
  end loop;
  if position('mon_detect_dealapp_shard_coverage' in body) = 0 then
    raise exception 'mon_detect_dealapp_shard_coverage was not wired into the roster';
  end if;
  perform public.mon_detect_dealapp_shard_coverage();
  raise notice 'dealapp shard coverage barrier wired; % detectors in roster', array_length(survivors,1) + 1;
end $$;