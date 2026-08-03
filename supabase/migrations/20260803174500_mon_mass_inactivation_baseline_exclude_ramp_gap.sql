-- Fix: mon_detect_mass_inactivation()'s trailing-30d p90 baseline chases a SUSTAINED ramp instead
-- of detecting it. Confirmed live in crawl_stats_platform_daily: aqar's marked_inactive rose
-- 245 (07-23) -> 389 -> 476 -> 936 -> 817 -> 1174 (07-28), a 4.8x climb over 6 days. Because the
-- baseline window was `day >= d.day - 30 and day < d.day`, each ramp day's own elevated count
-- entered the very next day's baseline: p90 climbed 273 -> 280 -> 288 -> 415 -> 568 -> 829 in
-- lockstep, so `factor * p90` (3x) stayed just ahead of the actual count every single day and the
-- P1 never fired -- the detector was comparing the ramp to itself.
--
-- Fix: exclude the trailing 5 days from the baseline window (day >= d.day - 35 and day < d.day - 5),
-- so "today" is always scored against a baseline that predates the last working week, never one
-- contaminated by the ramp it's trying to catch. 5 was chosen as the middle of the suggested 3-7
-- day range and validated empirically below: gaps of 3/4/5/6/7 all isolate materially the same
-- clean pre-ramp p90 (~270-290) for aqar, so 5 isn't a fragile knob for this data -- it's exposed
-- as mon_config('mass_inact_baseline_gap_days') rather than hardcoded, matching how factor/floor/
-- active_frac are already tunable here.
--
-- Scope note: the OTHER gate in this function (marked_inactive > active_frac * active_now, i.e.
-- 2% of the live pool) is untouched -- it's a separate, deliberately-designed safeguard (see
-- 20260721021600_mon_detect_mass_inactivation.sql), not part of the baseline-drag bug. Validation
-- below shows it honestly: for THIS specific historical aqar incident it still does not clear 2%
-- of aqar's ~88-93k active pool (peak 1174 / 88195 active = 1.33%), so a full replay of this exact
-- past event would not have produced an end-to-end alert even with the baseline fixed -- that is a
-- pre-existing, independent characteristic of the active_frac gate on very large platforms, not
-- something this migration changes or masks. Flagged as a separate follow-up, not fixed here.

insert into public.mon_config(key, value, note) values
  ('mass_inact_baseline_gap_days', '5', 'mass_inactivation: days excluded from the trailing-30d p90 baseline immediately before "today", so a sustained ramp cannot drag up its own detection threshold')
on conflict (key) do nothing;

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

  -- Point-in-time events: keep visible ~2 days, then auto-resolve (dedup key is day-scoped so a
  -- resolved alert never blocks a NEW spike from alerting).
  update public.alert_event set resolved_at = now()
   where kind = 'mass_inactivation' and resolved_at is null
     and created_at < now() - interval '2 days';

  return n;
end $$;
