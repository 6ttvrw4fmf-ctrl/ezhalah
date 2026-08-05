-- REVERT of 20260804113559 (applied by the nightly health report, 2026-08-04 11:35Z).
--
-- What went wrong: the nightly report read pg_get_functiondef() at ~21:0xZ on 2026-08-03 — DURING
-- the 3h monitoring blackout — then wrote a create-or-replace from that stale snapshot 14h later.
-- By then senior audit run #4 (20260803224508) had already fixed the date-numeric crash and run #5
-- (20260804063424) had rebuilt the sweep with an 18-detector roster + crash isolation. The stale
-- write silently dropped FOUR detectors back to orphaned:
--   mon_detect_unverified_inactivation, mon_detect_deletion_spike,
--   mon_detect_search_gate_leak, mon_detect_orphaned_detectors
-- i.e. the exact failure mode 20260804063424 was written to prevent, committed against itself.
--
-- This migration restores both function bodies VERBATIM from those two migrations. No new logic.

-- ── restore mon_detect_mass_inactivation from 20260803224508 (cast form) ─────────────────────
create or replace function public.mon_detect_mass_inactivation()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  rec record; n int := 0;
  factor numeric; floor_n numeric; frac numeric; gap_days numeric; thresh numeric;
begin
  select value::numeric into factor   from public.mon_config where key = 'mass_inact_factor';
  select value::numeric into floor_n  from public.mon_config where key = 'mass_inact_floor';
  select value::numeric into frac     from public.mon_config where key = 'mass_inact_active_frac';
  select value::numeric into gap_days from public.mon_config where key = 'mass_inact_baseline_gap_days';
  factor   := coalesce(factor, 3);
  floor_n  := coalesce(floor_n, 50);
  frac     := coalesce(frac, 0.02);
  gap_days := coalesce(gap_days, 5);

  for rec in
    select d.day, d.platform, d.marked_inactive, d.active_now, h.p90
    from public.crawl_stats_platform_daily d
    cross join lateral (
      select coalesce(percentile_cont(0.9) within group (order by h2.marked_inactive), 0) as p90
      from public.crawl_stats_platform_daily h2
      where h2.platform = d.platform
        -- `date - integer` (was `date - numeric`, which does not exist and crashed the detector)
        and h2.day >= d.day - (30 + gap_days)::int
        and h2.day <  d.day - gap_days::int
    ) h
    where d.day >= current_date - 1
      and d.marked_inactive > floor_n
  loop
    thresh := greatest(floor_n, factor * rec.p90);
    if rec.marked_inactive > thresh
       and rec.marked_inactive > frac * greatest(rec.active_now, 1) then
      n := n + public.mon_raise('P1', 'mass_inactivation', rec.platform,
        'mass_inactivation:' || rec.platform || ':' || rec.day,
        jsonb_build_object(
          'day', rec.day, 'marked_inactive', rec.marked_inactive,
          'threshold', round(thresh), 'p90_30d', round(rec.p90),
          'active_now', rec.active_now,
          'factor', factor, 'floor', floor_n, 'active_frac', frac, 'baseline_gap_days', gap_days));
    end if;
  end loop;

  update public.alert_event set resolved_at = now()
   where kind = 'mass_inactivation' and resolved_at is null
     and created_at < now() - interval '2 days';

  return n;
end $$;

-- ── restore mon_run_all_detectors from 20260804063424 (18-detector roster, crash-isolated) ───
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
    'mon_detect_search_gate_leak',          -- new in 20260804063424
    'mon_detect_orphaned_detectors'         -- new in 20260804063424
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
