-- Senior audit run #5 (2026-08-04). Three monitoring defects. All detect-only: no listing data,
-- no taxonomy, no search semantics, no product behaviour is touched by this migration.
--
-- 1. TWO DETECTORS WERE RUNNING NOWHERE.
--    mon_detect_unverified_inactivation() was wired into mon_run_all_detectors by senior run #3
--    (migration 20260803115206) and silently dropped ~8h later by 20260803194308
--    (mon_english_district_leak_detector), which rebuilt mon_run_all_detectors from a pre-run#3
--    base. mon_detect_deletion_spike() has never been reachable at all: no cron job, no caller.
--    Verified before this write: neither name appears in mon_run_all_detectors' definition nor in
--    any cron.job command. So the PR#256 "unverified_inactivations_24h must be 0" contract and the
--    irreversible-hard-delete spike guard have both been unmonitored — which is why today's breach
--    (dealapp id 6113922, killed 2026-08-03 19:45Z) raised no alert and was found only because the
--    daily engineer queried the view by hand.
--
-- 2. THE SWEEP STILL ABORTS ON THE FIRST DETECTOR THAT RAISES.
--    That is exactly what blinded production monitoring for 3h+ on 2026-08-03: one type error in
--    mon_detect_mass_inactivation() failed pg_cron job 38 7/7 runs and took the whole suite plus
--    alert dispatch down with it. Run #4 fixed that specific crash and added an external watchdog
--    (job 53) so the blackout would at least be visible; the fragility itself is fixed here. Each
--    detector now runs in its own subtransaction, and a failure raises a P1 naming the detector
--    instead of silencing the other seventeen.
--
-- 3. THE BUY TOKEN-PRICE GATE WAS BEING MEASURED BY ITS OWN FLAG, NOT BY WHAT USERS GET.
--    mon_buy_token_price.gated_lt_1000 counts rows flagged NOT production_ready. It has read
--    266/266 "gated" while location_search_candidates_ar returns all 266 of them, because the RPC
--    requires production_ready ONLY when p_cities/p_districts/p_region_ids is passed — the
--    unfiltered browse path waives it. mon_detect_search_gate_leak() asks the production RPC on
--    that same unfiltered path, so a gate can never again be certified by the flag it sets rather
--    than by the results the user actually sees. Detect-only: repairing the RPC predicate changes
--    search semantics and is left for owner approval.

-- ── 3. user-truth gate detector ──────────────────────────────────────────────────────────────
create or replace function public.mon_detect_search_gate_leak()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; leaked int; leaked_filtered int;
begin
  -- p_price_max 999 with NO location filter is exactly the owner-approved Buy token-price cohort,
  -- asked through the same RPC the frontend and the AI agent call. p_limit 1 is enough: total_count
  -- is count(*) over() across the whole matched set, so we pay for the scan, not the transfer.
  select coalesce(max(total_count), 0) into leaked
    from public.location_search_candidates_ar(p_deal := 'بيع', p_price_max := 999, p_limit := 1);
  -- Same question WITH a city filter. The two numbers differing is the signature of the defect:
  -- the gate holds on the filtered path and is waived on the unfiltered one.
  select coalesce(max(total_count), 0) into leaked_filtered
    from public.location_search_candidates_ar(p_deal := 'بيع', p_price_max := 999,
                                              p_cities := array['الرياض'], p_limit := 1);

  if leaked > 0 then
    n := public.mon_raise('P1', 'search_gate_leak', 'all',
      'search_gate_leak:buy_token_price:' || current_date,
      jsonb_build_object(
        'leaked_unfiltered', leaked,
        'leaked_with_city_filter', leaked_filtered,
        'contract', 'owner-approved interim gate (20260803112311): deal=بيع with 0<price_total<1000 must not be searchable',
        'root_cause', 'location_search_candidates_ar requires production_ready ONLY when p_cities/p_districts/p_region_ids is passed; the unfiltered browse path waives it',
        'note', 'detect-only — repairing the RPC predicate changes search semantics, owner approval required'));
  end if;

  -- Point-in-time events: auto-resolve after ~2 days. The dedup key is day-scoped, so a still-open
  -- leak re-raises tomorrow rather than sitting resolved-but-broken.
  update public.alert_event set resolved_at = now()
   where kind = 'search_gate_leak' and resolved_at is null
     and created_at < now() - interval '2 days';

  return n;
end $function$;

-- ── 1b. meta-guard: a detector that no one calls is not a detector ───────────────────────────
create or replace function public.mon_detect_orphaned_detectors()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; orphans text[];
begin
  -- Reachability, not intent: a mon_detect_* function must be called by mon_run_all_detectors or
  -- own a cron job (district_resolution/price_fidelity/wasalt_enrich_backlog each own one). This
  -- is the guard for the defect class itself — a later create-or-replace rebuilding the sweep from
  -- a stale base is how mon_detect_unverified_inactivation went dark 8h after run #3 wired it.
  select coalesce(array_agg(p.proname order by p.proname), '{}') into orphans
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname like 'mon\_detect\_%'
     and p.proname <> 'mon_detect_orphaned_detectors'
     and not exists (select 1 from pg_proc r
                      where r.pronamespace = 'public'::regnamespace
                        and r.proname = 'mon_run_all_detectors'
                        and position(p.proname in pg_get_functiondef(r.oid)) > 0)
     and not exists (select 1 from cron.job j where position(p.proname in j.command) > 0);

  if cardinality(orphans) > 0 then
    n := public.mon_raise('P2', 'orphaned_detector', 'all',
      'orphaned_detector:' || array_to_string(orphans, ','),
      jsonb_build_object('orphans', to_jsonb(orphans),
        'why', 'these mon_detect_* functions are reachable from neither mon_run_all_detectors nor a cron job, so they never run and their contract is unmonitored'));
  end if;

  return n;
end $function$;

-- ── 1a + 2. rebuild the sweep: full roster, crash-isolated ───────────────────────────────────
create or replace function public.mon_run_all_detectors()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  -- The sweep's roster. Keep it here and nowhere else: mon_detect_orphaned_detectors() (last in
  -- the list, and itself reachable because it is in the list) raises a P2 for any mon_detect_*
  -- function that is in neither this array nor a cron job of its own.
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
    'mon_detect_unverified_inactivation',   -- re-wired (run #3's 20260803115206, dropped by 20260803194308)
    'mon_detect_deletion_spike',            -- wired for the first time; never had a caller
    'mon_detect_search_gate_leak',          -- new this migration
    'mon_detect_orphaned_detectors'         -- new this migration
  ];
  fn text; raised int; result jsonb := '{}'::jsonb; failed text[] := '{}';
begin
  foreach fn in array fns loop
    begin
      execute format('select public.%I()', fn) into raised;
      result := result || jsonb_build_object(replace(fn, 'mon_detect_', ''), raised);
    exception when others then
      -- One broken detector must never blind the other seventeen (2026-08-03 blackout). Report the
      -- failure as a P1 in the same channel the detectors themselves use, and keep sweeping.
      failed := failed || fn;
      result := result || jsonb_build_object(replace(fn, 'mon_detect_', ''), 'ERROR: ' || sqlerrm);
      begin
        perform public.mon_raise('P1', 'detector_crash', 'all',
          'detector_crash:' || fn || ':' || current_date,
          jsonb_build_object('detector', fn, 'sqlstate', sqlstate, 'error', sqlerrm));
      exception when others then
        null;  -- never let the reporter take down the sweep it is reporting on
      end;
    end;
  end loop;

  return result || jsonb_build_object('ran_at', now(), 'failed', to_jsonb(failed));
end $function$;
