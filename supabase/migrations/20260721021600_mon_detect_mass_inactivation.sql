-- D13 · mass-inactivation spike detector (owner-approved 2026-07-21, follow-up to the 07-20
-- investigation: aqar's one-time 4,217-row backlog flush was CORRECT but surfaced only because
-- the owner eyeballed the inactive total — no detector fired; D4 volume_drop correctly ignored
-- a 4.2% active_now dip). This detector watches the KILL COUNT itself, per platform, against
-- that platform's OWN trailing-30-day history — no fixed global threshold (owner requirement).
--
-- Rule: P1 when a platform-day's marked_inactive exceeds BOTH
--   • max(mass_inact_floor, mass_inact_factor × trailing-30d p90 of that platform), AND
--   • mass_inact_active_frac × the platform's active_now
-- Back-tested on 30d of crawl_stats_platform_daily: fires on the 2026-07-20 aqar event
-- (4,220 > 819 and > 2% of 93k) and on aqar's earlier 3,257 day; stays silent on wasalt's
-- lumpy-but-normal 1,184–1,500 enum-strike nights, gathern's 1,217 max, and every routine day.
--
-- Evaluates today's AND yesterday's rows (kill counts land in crawl_stats_platform_daily at the
-- pulse; checking both days bounds detection lag without re-scanning 60+ raw tables hourly).
-- Dedup key includes the day, so one event alerts exactly once. Spike alerts auto-resolve after
-- 2 days (a spike is a point-in-time event — mon_resolve's condition-based pattern doesn't fit).

insert into public.mon_config(key, value, note) values
  ('mass_inact_factor',      '3',    'mass_inactivation: multiple of the platform''s trailing-30d p90 of marked_inactive'),
  ('mass_inact_floor',       '50',   'mass_inactivation: absolute kill-count floor below which no alert fires'),
  ('mass_inact_active_frac', '0.02', 'mass_inactivation: kill count must also exceed this fraction of the platform''s active_now')
on conflict (key) do nothing;

create or replace function public.mon_detect_mass_inactivation()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  rec record; n int := 0;
  factor numeric; floor_n numeric; frac numeric; thresh numeric;
begin
  select value::numeric into factor  from public.mon_config where key = 'mass_inact_factor';
  select value::numeric into floor_n from public.mon_config where key = 'mass_inact_floor';
  select value::numeric into frac    from public.mon_config where key = 'mass_inact_active_frac';
  factor  := coalesce(factor, 3);
  floor_n := coalesce(floor_n, 50);
  frac    := coalesce(frac, 0.02);

  for rec in
    select d.day, d.platform, d.marked_inactive, d.active_now, h.p90
    from public.crawl_stats_platform_daily d
    cross join lateral (
      select coalesce(percentile_cont(0.9) within group (order by h2.marked_inactive), 0) as p90
      from public.crawl_stats_platform_daily h2
      where h2.platform = d.platform and h2.day >= d.day - 30 and h2.day < d.day
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
          'factor', factor, 'floor', floor_n, 'active_frac', frac));
    end if;
  end loop;

  -- Point-in-time events: keep visible ~2 days, then auto-resolve (dedup key is day-scoped so a
  -- resolved alert never blocks a NEW spike from alerting).
  update public.alert_event set resolved_at = now()
   where kind = 'mass_inactivation' and resolved_at is null
     and created_at < now() - interval '2 days';

  return n;
end $$;

-- Wire into the hourly runner. Rebuilt from the LIVE pg_get_functiondef fetched 2026-07-21
-- (12 detectors a..l) + the new call — full-body replace, same zero-arg signature (no overload).
create or replace function public.mon_run_all_detectors()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; j int; k int; l int; m int;
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
  l := public.mon_detect_rls_reachability();
  m := public.mon_detect_mass_inactivation();
  return jsonb_build_object('silent_scraper_death',a,'zero_new_stall',b,'stale_active',c,
    'volume_drop',d,'cron_health',e,'stale_refresh',f,'legacy_alert_tables',g,
    'field_integrity',h,'search_index_freshness',i,'quarantine_growth',j,
    'registry_orphans',k,'rls_reachability',l,'mass_inactivation',m,'ran_at',now());
end $function$;
