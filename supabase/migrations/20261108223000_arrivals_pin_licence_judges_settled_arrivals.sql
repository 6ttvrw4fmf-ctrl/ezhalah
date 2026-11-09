-- 🔧 2026-11-08 (owner 3295 «fix the ones that come back, the root»: repeat_bug arrivals_pin_or_licence_dip, 5 raises in
-- 7 days). arrivals_pin_licence_coverage() judged arrivals of the LAST 24 h, including ones still inside the pipeline that
-- carries the pin and licence: wasalt's Arabic detail fetch runs every 4 h and the search index syncs hourly. Measured
-- 21:59: wasalt 60 arrivals at 16.7% pin/licence — first seen 21:10, Arabic-fetched 21:45, after the 21:43 sync — while
-- arrivals aged 5–29 h read 100% / 100% (haraj 77% pin vs floor 75). Every raise was that lag.
-- Root fix: judge arrivals once they have had time to settle — the same 24 h width, aged 5 h to 29 h (4 h enrich + 1 h
-- sync) — against the 7 days before that. A capture bug still shows in full, five hours later; a lag no longer does.
create or replace function public.arrivals_pin_licence_coverage()
 returns table(platform text, arrivals bigint, pin_pct numeric, pin_floor integer, lic_pct numeric, lic_pct_7d numeric, pin_dip boolean, lic_dip boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with w as (
    select s.platform, (s.first_seen_at > now() - interval '29 hours') as today,
           (s.latitude is not null) as pin, (s.license_number is not null) as lic
      from public.search_listings_ar s
     where s.production_ready
       and s.first_seen_at > now() - interval '8 days 5 hours'
       and s.first_seen_at <= now() - interval '5 hours'),
  g as (
    select w.platform,
           count(*) filter (where today) as arrivals,
           round(100.0 * avg(pin::int) filter (where today), 1) as pin_pct,
           round(100.0 * avg(lic::int) filter (where today), 1) as lic_pct,
           round(100.0 * avg(lic::int) filter (where not today), 1) as lic_pct_7d,
           count(*) filter (where not today) as prior_n
      from w group by w.platform)
  select g.platform, g.arrivals, g.pin_pct, d.floor_pct, g.lic_pct, g.lic_pct_7d,
         g.arrivals >= 50 and d.floor_pct > 1 and d.pin_source <> 'none' and g.pin_pct < d.floor_pct as pin_dip,
         g.arrivals >= 50 and ((g.prior_n >= 50 and g.lic_pct_7d >= 90 and g.lic_pct < g.lic_pct_7d / 2)
                                 -- platforms proven to publish the licence on every ad (aqar: 2026-11-06, 1356)
                                 or (g.platform = any (array['aqar']) and coalesce(g.lic_pct, 0) < 50)) as lic_dip
    from g left join public.ops_pin_source_declared d on d.platform = g.platform
   where g.arrivals > 0;
$function$;
