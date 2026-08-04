-- P1 HOTFIX (senior audit run #4, 2026-08-03 22:4x UTC).
--
-- Migration 20260803190624 (mon_mass_inactivation_baseline_exclude_ramp_gap) introduced a
-- baseline-gap window using `gap_days`, declared `numeric`, subtracted directly from a `date`:
--
--     and h2.day >= d.day - 30 - gap_days
--     and h2.day <  d.day - gap_days
--
-- There is no `date - numeric` operator in Postgres, so mon_detect_mass_inactivation() raises
--   ERROR: operator does not exist: date - numeric
-- on EVERY invocation. That function is called from mon_run_all_detectors(), which pg_cron job 38
-- (mon-detectors-and-dispatch, `20,50 * * * *`) runs in a single transaction — so the exception
-- aborted the WHOLE detector sweep AND the alert dispatch that follows it.
--
-- Live evidence before this write: cron.job_run_details jobid=38 — last success 2026-08-03 18:50Z,
-- then 7/7 consecutive failures 19:20Z → 22:20Z with the error above. During that window the only
-- alerts raised came from jobs OTHER than 38 (jobid 40, wasalt enrich backlog): the entire
-- monitoring/alerting surface (price fidelity, unverified inactivation, quarantine growth, mass
-- inactivation, novel types, english-district leak, …) was silently blind for 3+ hours.
--
-- Fix: cast the gap to integer at the two subtraction sites, so `date - integer` is used.
-- No threshold, config key, semantics or output changes — mass_inact_baseline_gap_days is still
-- read from mon_config and still defaults to 5. Purely a type fix restoring intended behavior.

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

  -- Point-in-time events: keep visible ~2 days, then auto-resolve (dedup key is day-scoped so a
  -- resolved alert never blocks a NEW spike from alerting).
  update public.alert_event set resolved_at = now()
   where kind = 'mass_inactivation' and resolved_at is null
     and created_at < now() - interval '2 days';

  return n;
end $$;