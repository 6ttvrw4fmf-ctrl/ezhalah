-- ─────────────────────────────────────────────────────────────────────────────────────────
-- Final-stage SEARCH-INDEX FRESHNESS detector (owner request 2026-07-16). Closes the last
-- monitoring gap: existing detectors watch scrape/enrichment/platform health, but nothing watched
-- whether the END of the pipeline — search_listings_ar — is actually staying fresh, i.e. whether
-- valid new listings are reaching search. Applied LIVE via Supabase MCP 2026-07-16; this file
-- mirrors exactly what was applied (recoverability — MCP migrations are otherwise live-only).
--
-- WHY NOT just watch search_listings_ar.last_updated:
--   That column is sourced (via listing_native_location_v1/v2) from listing_location_canonical, an
--   UNMAINTAINED table whose last_updated is frozen ~15-18h behind wall-clock even while listings
--   flow into search perfectly (verified 2026-07-16: raw scrapers fresh to 16:40, backlog to search
--   = 0, yet max(last_updated) stuck at 04:31). Using last_updated as a freshness signal would fire
--   a PERMANENT false alarm. This detector instead measures the TWO signals that actually reflect
--   pipeline flow and cannot be fooled by that stale column:
--     1. BACKLOG — production_ready buy/rent rows in listing_native_location_v2 that are NOT yet in
--        search_listings_ar (the true count of valid active listings waiting to enter search).
--     2. SYNC-ADVANCE — whether the hourly sync job (pg_cron jobid 28, sync_search_listings_ar) has
--        actually SUCCEEDED recently. "Job reports success but index does not advance" is caught by
--        combining the two: a recent successful sync PLUS a non-trivial backlog = it ran but isn't
--        clearing.
--
-- Thresholds (owner spec): P2 (stale) at >3h since a successful sync OR backlog > 500; P1 (severe)
-- at >6h OR backlog > 5000; a distinct P1 "no_advance" when sync succeeded <90m ago yet backlog
-- still > 500. Auto-resolves (mon_resolve) the instant freshness recovers. Consistent with the
-- existing mon_detect_*/mon_raise/mon_resolve architecture (alert_event + monitoring_dashboard,
-- dispatched hourly by jobid 38 mon-detectors-and-dispatch).

-- ============================================================================
-- 1) search_index_freshness() — on-demand snapshot (the display helper). Returns every field the
--    owner asked to see, queryable any time by ops. SECURITY DEFINER so it can read cron.* +
--    the raw tables regardless of caller; service-role only, matching the other mon_* functions.
-- ============================================================================
create or replace function public.search_index_freshness()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_backlog bigint;
  v_backlog_platforms jsonb;
  v_newest_raw timestamptz;
  v_newest_indexed timestamptz;   -- content timestamp (last_updated); UNRELIABLE, shown for reference only
  v_last_sync timestamptz;
  v_sync_recent boolean;
  v_lag_min numeric;
begin
  -- BACKLOG (+ per-platform) in a single scan of the eligible set.
  with elig as (
    select v.platform
    from public.listing_native_location_v2 v
    left join public.search_listings_ar s
      on s.source_table = v.source_table and s.listing_id = v.listing_id
    where v.production_ready
      and lower(v.transaction_type) in ('buy','rent')
      and s.listing_id is null
  )
  select count(*), coalesce(jsonb_object_agg(platform, cnt) filter (where platform is not null), '{}'::jsonb)
  into v_backlog, v_backlog_platforms
  from (select platform, count(*) cnt from elig group by platform) q;

  -- NEWEST RAW across the highest-volume platforms (a system-wide scraper halt shows here).
  select max(mx) into v_newest_raw from (
    select max(last_seen_at) mx from public.wasalt_residential_listings   where active
    union all select max(last_seen_at) from public.aqar_residential_listings        where active
    union all select max(last_seen_at) from public.gathern_residential_listings     where active
    union all select max(last_seen_at) from public.dealapp_residential_listings     where active
    union all select max(last_seen_at) from public.aqarmonthly_residential_listings where active
  ) r;

  select max(last_updated) into v_newest_indexed from public.search_listings_ar;

  -- LAST SUCCESSFUL SYNC (jobid 28 = sync-search-listings-ar). This is the operative "did the index
  -- advance" clock — hourly when healthy, so a gap > a couple hours means the index truly stalled.
  select max(end_time) into v_last_sync
  from cron.job_run_details where jobid = 28 and status = 'succeeded';
  v_sync_recent := v_last_sync is not null and v_last_sync > now() - interval '90 minutes';
  v_lag_min := round(extract(epoch from (now() - coalesce(v_last_sync, now() - interval '999 hours')))/60);

  return jsonb_build_object(
    'newest_raw_ts',      v_newest_raw,
    'newest_indexed_ts',  v_newest_indexed,
    'newest_indexed_note','content timestamp only (from unmaintained listing_location_canonical) — NOT a reliable freshness signal; use last_successful_sync_at + backlog',
    'last_successful_sync_at', v_last_sync,
    'lag_minutes',        v_lag_min,
    'backlog',            v_backlog,
    'backlog_by_platform', v_backlog_platforms,
    'sync_recent',        v_sync_recent,
    'measured_at',        now()
  );
end $function$;

grant execute on function public.search_index_freshness() to service_role, postgres;

-- ============================================================================
-- 2) mon_detect_search_index_freshness() — the detector. Raises/resolves via the shared helpers,
--    escalates/de-escalates severity without churn, auto-resolves on recovery.
-- ============================================================================
create or replace function public.mon_detect_search_index_freshness()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s jsonb;
  v_backlog bigint;
  v_lag_min numeric;
  v_sync_recent boolean;
  v_target text;                 -- 'P1' | 'P2' | null(healthy)
  v_open_sev text;
  n int := 0;
begin
  s := public.search_index_freshness();
  v_backlog     := (s->>'backlog')::bigint;
  v_lag_min     := (s->>'lag_minutes')::numeric;
  v_sync_recent := (s->>'sync_recent')::boolean;

  -- ---- stale detector (severity from the worse of: sync-gap, backlog) ----
  if v_lag_min > 360 or v_backlog > 5000 then
    v_target := 'P1';               -- >6h since a successful sync, or a large pile-up
  elsif v_lag_min > 180 or v_backlog > 500 then
    v_target := 'P2';               -- >3h, or a meaningful backlog
  else
    v_target := null;               -- healthy
  end if;

  select severity into v_open_sev
  from public.alert_event
  where dedup_key = 'search_index_stale' and resolved_at is null
  order by created_at desc limit 1;

  if v_target is null then
    if v_open_sev is not null then perform public.mon_resolve('search_index_stale','search_index'); end if;
  elsif v_open_sev is distinct from v_target then
    -- clear any lower/higher open alert of this kind, then raise at the current level
    if v_open_sev is not null then perform public.mon_resolve('search_index_stale','search_index'); end if;
    n := n + public.mon_raise(v_target, 'search_index_stale', 'search_index', 'search_index_stale',
      s || jsonb_build_object('why','search index is not staying fresh (sync-gap or backlog exceeded threshold)'));
  end if;
  -- (v_open_sev = v_target → already open at the right severity, leave it, no churn)

  -- ---- "success but no advance" detector (req #3): sync ran recently yet backlog persists ----
  if v_sync_recent and v_backlog > 500 then
    n := n + public.mon_raise('P1', 'search_index_no_advance', 'search_index', 'search_index_no_advance',
      s || jsonb_build_object('why','sync job succeeded within 90m but a backlog of valid listings is still not entering search'));
  else
    perform public.mon_resolve('search_index_no_advance','search_index');
  end if;

  return n;
end $function$;

grant execute on function public.mon_detect_search_index_freshness() to service_role, postgres;

-- ============================================================================
-- 3) Wire the new detector into the existing hourly orchestrator (jobid 38 already calls this via
--    mon_run_all_detectors → mon_dispatch_alerts). No new cron job needed. This CREATE OR REPLACE
--    only appends the one new call; every pre-existing detector is preserved byte-for-byte.
-- ============================================================================
create or replace function public.mon_run_all_detectors()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int;
begin
  a := public.mon_detect_silent_scraper_death();
  b := public.mon_detect_zero_new_stall();
  c := public.mon_detect_stale_active_fraction();
  d := public.mon_detect_volume_drop();
  e := public.mon_detect_cron_health();
  f := public.mon_detect_stale_refresh();
  g := public.mon_detect_legacy_alert_tables();
  h := public.mon_detect_field_integrity();
  i := public.mon_detect_search_index_freshness();
  return jsonb_build_object('silent_scraper_death',a,'zero_new_stall',b,'stale_active',c,
    'volume_drop',d,'cron_health',e,'stale_refresh',f,'legacy_alert_tables',g,
    'field_integrity',h,'search_index_freshness',i,'ran_at',now());
end $function$;
