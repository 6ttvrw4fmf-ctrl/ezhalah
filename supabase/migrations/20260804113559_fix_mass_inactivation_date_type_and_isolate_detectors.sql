-- P1 fix (2026-08-03/04): mon_run_all_detectors() aborted every run since 19:20 UTC.
-- Root cause: mon_detect_mass_inactivation declared gap_days numeric, so
--   `d.day - 30 - gap_days` resolved to `date - numeric` (no such operator).
-- gap_days is a day count -> declare it int.
CREATE OR REPLACE FUNCTION public.mon_detect_mass_inactivation()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rec record; n int := 0;
  factor numeric; floor_n numeric; frac numeric; gap_days int; thresh numeric;
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
        and h2.day >= d.day - 30 - gap_days
        and h2.day < d.day - gap_days
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
end $function$;

-- Recurrence guard: previously ONE failing detector aborted the whole transaction,
-- rolling back every other detector's alerts AND skipping mon_dispatch_alerts()
-- (both statements share the jobid-38 transaction) -> total monitoring blackout.
-- Now each detector is isolated; a failing one raises its own P1 and the rest still run.
CREATE OR REPLACE FUNCTION public.mon_run_all_detectors()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  det text; v int; res jsonb := '{}'::jsonb; failed int := 0;
  dets text[] := array[
    'silent_scraper_death','zero_new_stall','stale_active_fraction','volume_drop',
    'cron_health','stale_refresh','legacy_alert_tables','field_integrity',
    'search_index_freshness','quarantine_growth','registry_orphans',
    'rls_reachability','mass_inactivation','english_district_leak'];
begin
  foreach det in array dets loop
    begin
      execute format('select public.%I()', 'mon_detect_' || det) into v;
      res := res || jsonb_build_object(det, v);
    exception when others then
      failed := failed + 1;
      res := res || jsonb_build_object(det, 'ERROR: ' || sqlerrm);
      perform public.mon_raise('P1', 'detector_failure', det,
        'detector_failure:' || det || ':' || current_date,
        jsonb_build_object('detector', 'mon_detect_' || det,
                           'error', sqlerrm, 'sqlstate', sqlstate));
    end;
  end loop;
  return res || jsonb_build_object('ran_at', now(), 'failed_detectors', failed);
end $function$;
