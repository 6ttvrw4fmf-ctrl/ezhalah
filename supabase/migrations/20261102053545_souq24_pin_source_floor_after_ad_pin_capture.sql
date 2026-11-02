-- souq24's pin floor 1 → 75 (⚡ 2026-11-02, backlog 1111). The scraper reads the ad's own «الحصول على الإتجاه» Maps
-- link since #9739; its first crawl on current main (small-sources-sync 41392490309, scrape_run 93827, 05:24 UTC)
-- stored 38 of 46 pins (35 distinct pairs; the site's 24.7136 Riyadh-centre fallback is never stored) and the 05:22
-- search sync serves 38/46 = 82.6 %. 75 leaves room for an ad without a marker; a fall below it is a regression.
-- data/pin-sources.json carries the same row (verify-pin-capture-declared.ts needs this literal).
insert into public.ops_pin_source_declared (platform, pin_source, floor_pct, proven_on) values
  ('souq24', 'ad-page', 75, date '2026-11-02')
on conflict (platform) do update set pin_source = excluded.pin_source, floor_pct = excluded.floor_pct,
  proven_on = excluded.proven_on, declared_at = now();

do $proof$
declare n bigint;
begin
  select count(*) into n from public.pin_coverage_by_platform() where below_floor and platform = 'souq24';
  if n <> 0 then raise exception 'PROOF: souq24 is below its new floor'; end if;
  if (select floor_pct from public.ops_pin_source_declared where platform = 'souq24') <> 75 then raise exception 'PROOF: souq24 floor did not land'; end if;
  raise notice 'PROOF OK: souq24 floor 75';
end $proof$;
