-- بيشة AND الدرعية EACH EXIST TWICE IN loc_catalog_city, SAME NAME, SAME NORM TOKEN.
--
-- Discovered 2026-09-23 investigating "30 cities with a district catalog but zero listings" — most
-- are genuinely tiny hamlets, but two are real, active cities: الدرعية (629 listings) and بيشة (149
-- listings). Neither was actually empty. Their listings all resolved to ONE city_id (664 / 1301);
-- their district catalog (17 + 28 districts) was built under a DIFFERENT city_id (828 / 1514) that
-- share the exact same city_ar and city_norm ('الدرعيه' / 'بيشه') but never receives a single
-- listing. Two folders, same label — the district picker was reading the empty one.
--
-- FIX: move the district rows from the dead twin to the live twin. Nothing about matching logic,
-- normalization, or the fold rule changes — this is purely correcting which city_id two existing
-- rows point at.
--
--   loc_catalog_district (the picker's own catalog, UNIQUE(city_id, district_norm)):
--     verified 0 overlap between the dead and live twin for both cities — a straight move.
--
--   loc_canonical_district (the matching/attestation table, PK (city_id, district_norm)):
--     the live twin already has SOME of the same districts (8 for الدرعية, 20 for بيشة — makes
--     sense, since someone had to build matching for the twin that was actually receiving
--     listings). Moving those would collide on the PK, so only the NON-overlapping rows move; the
--     colliding ones stay under the dead id as harmless orphans (the live id already resolves them).
--
-- VERIFIED against the real picker RPC immediately after applying: district_options_ar(664) and
-- district_options_ar(1301) both return real districts with real, nonzero listing_count summing
-- toward the city's true total (629 / 149).
--
-- NOT done here, deliberately conservative: the dead loc_catalog_city rows (828, 1514) are left in
-- place, not deleted or merged — they now simply own zero districts. Whether they should be removed,
-- and whether the SAME duplicate-city-id pattern exists elsewhere in the catalog beyond this pair,
-- is a separate, unaudited question — reported alongside this fix, not resolved by it.

update public.loc_catalog_district set city_id = 664 where city_id = 828;    -- الدرعية: 828 (dead) -> 664 (live, 629 listings)
update public.loc_catalog_district set city_id = 1301 where city_id = 1514; -- بيشة: 1514 (dead) -> 1301 (live, 149 listings)

update public.loc_canonical_district src
set city_id = 664
where src.city_id = 828
  and not exists (
    select 1 from public.loc_canonical_district dst
    where dst.city_id = 664 and dst.district_norm = src.district_norm
  );

update public.loc_canonical_district src
set city_id = 1301
where src.city_id = 1514
  and not exists (
    select 1 from public.loc_canonical_district dst
    where dst.city_id = 1301 and dst.district_norm = src.district_norm
  );
