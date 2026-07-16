-- ─────────────────────────────────────────────────────────────────────────────────────────
-- INGESTION WATCHDOGS (2026-07-16, final piece of the owner's ingestion workstream).
--
-- TRIMMED from the original 4-fix draft after live reconciliation: FIX 1 (attribute-drift
-- re-sync) and the index-stall watch are ALREADY LIVE — a concurrent session shipped them
-- (sync_search_listings_ar's s3 arm now covers deal_ar + price/area/bedrooms/property_age
-- drift, and mon_detect_search_index_freshness covers backlog/lag/no-advance; drifted-row
-- count verified 0 live before this migration was authored). What remained missing, and
-- ships here:
--   §1  mon_detect_quarantine_growth() — per-platform unresolved-location (production_ready
--       =false) growth watchdog with a history snapshot table; raghdan (168/345 unready,
--       49%) fires on the first run by design.
--   §2  mon_detect_registry_orphans()  — registry⇄runs⇄tables consistency: an active
--       registry platform with no runs AND no tables, or a run label absent from the
--       registry (the aqar/aqar_residential label split must NOT false-fire — both are
--       registered).
--   §3  orchestrator: the LIVE nine-detector def (captured 2026-07-16 21:2x, includes
--       search_index_freshness) + exactly these two new calls. Extend, never regress.
-- Alert-only; nothing here modifies a listing. Detectors dedup via mon_raise.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- ═══ FIX 2 · quarantine-growth watchdog: history table + seed + detector ═════════════════

create table if not exists public.mon_quarantine_snapshot (
  platform    text        not null,
  captured_at timestamptz not null default now(),
  unready     integer     not null,
  total       integer     not null,
  primary key (platform, captured_at)
);
alter table public.mon_quarantine_snapshot enable row level security;   -- no policies on purpose:
revoke all on public.mon_quarantine_snapshot from public, anon, authenticated;  -- definer-only state

-- Day-0 baseline seed: today's LIVE per-platform quarantine counts. Without this the
-- absolute branch (floor 20) would P1 on the first tick for every KNOWN standing
-- population (wasalt 791, dealapp 254, aqarcity 58, gathern 57, sanadak 55 …) — those are
-- steady-state location-unresolved rows, not growth. Growth relative to this baseline
-- (and every later snapshot) is what pages.
insert into public.mon_quarantine_snapshot (platform, captured_at, unready, total)
select platform, now(),
       count(*) filter (where not production_ready),
       count(*)
from public.search_listings_ar
group by platform
on conflict do nothing;

create or replace function public.mon_detect_quarantine_growth()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  n int := 0;
  v_median numeric;
  v_thresh_abs numeric;
  v_fired boolean;
begin
  for rec in
    select platform,
           count(*) filter (where not production_ready) as unready,
           count(*) as total
    from public.search_listings_ar
    group by platform
  loop
    -- 7-day median of this platform's quarantine size, from snapshots taken BEFORE this
    -- evaluation (self-damping: the current value never feeds its own baseline).
    select percentile_cont(0.5) within group (order by h.unready)
      into v_median
    from public.mon_quarantine_snapshot h
    where h.platform = rec.platform
      and h.captured_at > now() - interval '7 days';

    -- absolute branch: floor 20; with history, 2× the 7-day median (never below the floor).
    v_thresh_abs := case when v_median is null then 20 else greatest(20, 2 * v_median) end;

    v_fired := rec.unready > v_thresh_abs
            or (rec.total > 0 and rec.unready::numeric / rec.total > 0.25);

    if v_fired then
      n := n + public.mon_raise('P1','quarantine_growth', rec.platform,
        'quarantine_growth:'||rec.platform,
        jsonb_build_object('platform', rec.platform, 'unready', rec.unready, 'total', rec.total,
          'frac', round(rec.unready::numeric / nullif(rec.total,0), 3),
          'median_7d', v_median, 'threshold_abs', v_thresh_abs,
          'why','quarantined (not production_ready) rows exceed 2x the 7-day median (floor 20) or 25% of the platform — these listings are invisible to search'));
    else
      update public.alert_event set resolved_at = now()
      where kind='quarantine_growth' and resolved_at is null
        and dedup_key = 'quarantine_growth:'||rec.platform;
    end if;

    -- append history (at most one snapshot per platform per hour; keep 30 days)
    insert into public.mon_quarantine_snapshot (platform, unready, total)
    select rec.platform, rec.unready, rec.total
    where not exists (select 1 from public.mon_quarantine_snapshot h2
                      where h2.platform = rec.platform
                        and h2.captured_at > now() - interval '55 minutes');
  end loop;
  delete from public.mon_quarantine_snapshot where captured_at < now() - interval '30 days';
  return n;
end $function$;


-- ═══ FIX 4 · registry ⇄ runs ⇄ tables consistency ════════════════════════════════════════

create or replace function public.mon_detect_registry_orphans()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  n int := 0;
  v_dead_keys text[] := '{}';
  v_label_keys text[] := '{}';
begin
  -- (i) dead registry entries: active, no runs inside window_days, and no backing tables.
  for rec in
    select pr.platform, coalesce(pr.window_days, 14) as wd
    from public.platform_registry pr
    where pr.status = 'active'
      and not exists (select 1 from public.scrape_runs r
                      where r.platform = pr.platform
                        and r.started_at > now() - make_interval(days => coalesce(pr.window_days, 14)))
      and not exists (select 1 from information_schema.tables t
                      where t.table_schema = 'public'
                        and t.table_name like pr.platform||'\_%\_listings')
  loop
    v_dead_keys := v_dead_keys || ('registry_orphan_dead:'||rec.platform);
    n := n + public.mon_raise('P2','registry_orphans', rec.platform,
      'registry_orphan_dead:'||rec.platform,
      jsonb_build_object('platform', rec.platform, 'window_days', rec.wd,
        'why','active platform_registry row with zero scrape_runs in its window and no <platform>_%_listings table — dead registry entry (retire it or fix the scraper identity)'));
  end loop;
  update public.alert_event set resolved_at = now()
  where kind='registry_orphans' and resolved_at is null
    and dedup_key like 'registry_orphan_dead:%'
    and dedup_key <> all(v_dead_keys);

  -- (ii) unregistered run labels: seen in scrape_runs inside 14d, no ':' namespace
  -- (aqar_liveness:* / aqar_cleanup:* pseudo-runs are bookkeeping, not platforms),
  -- absent from platform_registry under ANY status. The aqar / aqar_residential /
  -- aqar_commercial split is safe: all three labels are registered rows.
  for rec in
    select r.platform as label, count(*) as runs, max(r.started_at) as last_run
    from public.scrape_runs r
    where r.started_at > now() - interval '14 days'
      and position(':' in r.platform) = 0
      and not exists (select 1 from public.platform_registry pr where pr.platform = r.platform)
    group by r.platform
  loop
    v_label_keys := v_label_keys || ('registry_orphan_label:'||rec.label);
    n := n + public.mon_raise('P2','registry_orphans', rec.label,
      'registry_orphan_label:'||rec.label,
      jsonb_build_object('label', rec.label, 'runs_14d', rec.runs, 'last_run', rec.last_run,
        'why','scrape_runs label absent from platform_registry — an unregistered scraper is invisible to every per-platform detector (register it or fix its label)'));
  end loop;
  update public.alert_event set resolved_at = now()
  where kind='registry_orphans' and resolved_at is null
    and dedup_key like 'registry_orphan_label:%'
    and dedup_key <> all(v_label_keys);

  return n;
end $function$;


-- ═══ §3 · Orchestrator: LIVE nine detectors + the two new ones ═══════════════════════════
create or replace function public.mon_run_all_detectors()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; j int; k int;
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
  j := public.mon_detect_quarantine_growth();
  k := public.mon_detect_registry_orphans();
  return jsonb_build_object('silent_scraper_death',a,'zero_new_stall',b,'stale_active',c,
    'volume_drop',d,'cron_health',e,'stale_refresh',f,'legacy_alert_tables',g,
    'field_integrity',h,'search_index_freshness',i,'quarantine_growth',j,
    'registry_orphans',k,'ran_at',now());
end $function$;
