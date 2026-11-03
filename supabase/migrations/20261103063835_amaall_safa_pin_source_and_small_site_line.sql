-- Pins: amaall floor 1 → 75, safa re-declared «none», and the pin detector watches small sites too
-- (⚡ Scraping Engineer 2026-11-03, backlog 1197).
--
-- amaall: the WP REST fave_property_location pair is read since PR #10083 (the Florida theme default refused, a pair
--   on 3+ posts dropped); branch crawl 05:34 UTC stored 33/36 active rows, 26 distinct pairs; served after the 06:22 sync.
-- safa: every unit sheet and project page was read; the only Maps link is ONE maps.app.goo.gl link resolving to the
--   Google place «صفا للاستثمار» (the office), shared by every project → the 10-30 «ad-page» declaration was a misread.
-- superoffice stays project-page floor 1 (3/18: only the as-suwaidi branch prints its building embed).
-- pin_coverage_by_platform(): the «declared but serves 0» / «below floor» / «undeclared» checks applied only from 50
--   served ads, so 11 small sites (206 ads) sat at 0 pins with nothing red (🔧 11-02). The line is now 10 ads.
-- data/pin-sources.json carries the same rows (verify-pin-capture-declared.ts needs these literals).
insert into public.ops_pin_source_declared (platform, pin_source, floor_pct, proven_on) values
  ('amaall', 'page-json', 75, date '2026-11-03'),
  ('safa', 'none', 0, date '2026-11-03')
on conflict (platform) do update set pin_source = excluded.pin_source, floor_pct = excluded.floor_pct,
  proven_on = excluded.proven_on, declared_at = now();

create or replace function public.pin_coverage_by_platform()
 returns table(platform text, ads bigint, pins bigint, pct numeric, pin_source text, floor_pct integer, below_floor boolean, why text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select s.platform, count(*) ads, count(s.latitude) pins,
         round(100.0 * count(s.latitude) / count(*), 1) pct, d.pin_source, d.floor_pct,
         -- floor 1 means «publishes: at least one served pin» (a 1-of-101 site is not below a 1 % floor); floor 0 is `none`.
         -- From 10 served ads (was 50 until 2026-11-03: 11 small sites sat at 0 pins with nothing red).
         count(*) >= 10 and (d.platform is null
                             or (d.pin_source <> 'none' and count(s.latitude) = 0)
                             or (d.floor_pct > 1 and 100.0 * count(s.latitude) / count(*) < d.floor_pct)) as below_floor,
         case when count(*) < 10 then null
              when d.platform is null then 'undeclared: no row in data/pin-sources.json'
              when d.pin_source <> 'none' and count(s.latitude) = 0 then 'declared ' || d.pin_source || ' but serves 0 pins (the rakez shape)'
              when d.floor_pct > 1 and 100.0 * count(s.latitude) / count(*) < d.floor_pct then 'below its declared floor' end as why
    from public.search_listings_ar s
    left join public.ops_pin_source_declared d on d.platform = s.platform
   where s.production_ready
   group by s.platform, d.platform, d.pin_source, d.floor_pct
   order by 2 desc;
$function$;

do $proof$
declare n int;
begin
  if exists (select 1 from public.pin_coverage_by_platform() where platform in ('amaall', 'safa', 'superoffice') and below_floor) then
    raise exception 'PROOF: amaall / safa / superoffice still below floor';
  end if;
  select count(*) into n from public.pin_coverage_by_platform() where below_floor and ads < 50;
  if n = 0 then raise exception 'PROOF: the 10-ad line should now see the small zero-pin sites (flow, livingcompound, …)'; end if;
  raise notice 'PROOF OK: amaall/safa/superoffice clear; % small site(s) now visible to the detector', n;
end $proof$;