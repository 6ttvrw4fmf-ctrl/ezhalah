-- الحريق AND الحرجة, same shape as الدرعية/بيشة (migration 20260923234716): each exists twice in
-- loc_catalog_city, same city_norm token, one twin owns the district catalog with zero listings
-- while the other twin holds the real listings.
--
--   الحريق: dead 3158 (6 catalog districts, 0 listings) -> live 580 (0 catalog districts, 12 listings)
--   الحرجة: dead 3383 (1 catalog district, 0 listings) -> live 1551 (0 catalog districts, 1 listing)
--     (الحرجة's single listing verified same place: same region_id=6, same official-source duplicate
--     pattern as the other three confirmed pairs in sa-locations.json)
--
-- Verified 0 overlap in loc_catalog_district for both pairs -- straight move. loc_canonical_district
-- has 3/6 colliding rows for الحريق (skip, stay under dead id as harmless orphans) and 0/1 for الحرجة
-- (moves cleanly).
--
-- VERIFIED against the real picker RPC immediately after applying: district_options_ar(580) returns
-- 7 districts summing to 12 listings; district_options_ar(1551) returns 2 districts summing to 1.

update public.loc_catalog_district set city_id = 580 where city_id = 3158;
update public.loc_catalog_district set city_id = 1551 where city_id = 3383;

update public.loc_canonical_district src
set city_id = 580
where src.city_id = 3158
  and not exists (
    select 1 from public.loc_canonical_district dst
    where dst.city_id = 580 and dst.district_norm = src.district_norm
  );

update public.loc_canonical_district src
set city_id = 1551
where src.city_id = 3383
  and not exists (
    select 1 from public.loc_canonical_district dst
    where dst.city_id = 1551 and dst.district_norm = src.district_norm
  );
