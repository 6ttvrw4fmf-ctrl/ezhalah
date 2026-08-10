-- Audit 2026-08-10, Issue #2 (part 2): the legacy `listings_arabic_locations` overlay also overrode
-- the source-published Arabic district.
--
-- After 20260810131500 fixed the transliteration arm, 24 gathern rows still displayed a different
-- district than the source published. Traced end to end on listing 733057:
--   source additional_info->>'district_ar' = 'حي الظاهرة'
--   resolve_district_ar(city 14, source)   = 'حي الظاهرة'   ← resolver is CORRECT
--   listings_arabic_locations.district_ar  = 'حي الزهرة'    ← legacy overlay, wrong district
--   listing_native_location_v1.district_ar = 'حي الزهرة'    (v1 coalesces the overlay in)
-- The catalog holds BOTH districts distinctly (زهره → حي الزهرة, ظاهره → حي الظاهرة) and the
-- normalizers do not collide, so this is stale/derived overlay data, not a normalisation bug. v1 was
-- refreshed 2026-08-10 12:00 (not stale) — it faithfully recomputes the wrong overlay value.
--
-- No active writer produces gathern rows in that overlay (the resolve_* writers cover aqar, dealapp,
-- raghdan, the small platforms and the English city overlay), so these are legacy rows from an old
-- backfill. Repair them to source truth once, and bar the contradiction permanently.
--
-- Repair rule (source is truth; never fabricate): for every listing whose platform publishes its own
-- Arabic district, the overlay must carry the resolver's canonical rendering of THAT value — and NULL
-- when the source's district is not attested in the listing's city. We never keep a different
-- district just because it happens to be a real one. Platform-agnostic: driven entirely by the
-- listing_source_district_ar registry, so it covers any platform added there later.
--
-- Barrier: mon_district_contradicts_source (from 20260810131500) must stay 0 rows, asserted live by
-- scripts/verify-district-source-truth-live.ts.

update public.listings_arabic_locations lal
   set district_ar = public.resolve_district_ar(v1.city_id, sd.source_district_ar)
  from public.search_listings_ar s
  join public.listing_source_district_ar sd
    on sd.source_table = s.source_table and sd.listing_id = s.listing_id
  join public.listing_native_location_v1 v1
    on v1.source_table = s.source_table and v1.listing_id = s.listing_id
 where lal.platform   = s.platform
   and lal.listing_id = s.listing_id
   and lal.district_ar is not null
   and regexp_replace(regexp_replace(public.normalize_ar(lal.district_ar), '^حي ', ''), '^ال', '')
    <> regexp_replace(regexp_replace(public.normalize_ar(sd.source_district_ar), '^حي ', ''), '^ال', '');
