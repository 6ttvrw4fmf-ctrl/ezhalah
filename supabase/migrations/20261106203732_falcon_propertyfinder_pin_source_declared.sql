-- 🦅 falcon 2026-11-06: Property Finder's pin source was never declared, so pin_coverage_by_platform() reads it
-- below floor («undeclared: no row in data/pin-sources.json», alert pin_coverage_below_floor) while it serves
-- 4,544 pins on 4,549 ads (99.9 %). The pin is each ad's own payload property.location.coordinates
-- (scrapers/propertyfinder/run.py _location); source-reread run 42279053408 found it on the ad page. Same row as
-- data/pin-sources.json, the KW/almajdiah declaration pattern of 20261105084508.
insert into public.ops_pin_source_declared (platform, pin_source, floor_pct, proven_on) values
  ('propertyfinder', 'page-json', 95, date '2026-11-06')
on conflict (platform) do update set pin_source = excluded.pin_source, floor_pct = excluded.floor_pct,
  proven_on = excluded.proven_on, declared_at = now();

do $verify$
begin
  if exists (select 1 from public.pin_coverage_by_platform() where platform = 'propertyfinder' and below_floor) then
    raise exception 'propertyfinder still reads below its pin floor after the declaration';
  end if;
end $verify$;
