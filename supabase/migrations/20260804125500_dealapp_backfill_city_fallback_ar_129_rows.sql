-- deep-location-matching-audit 2026-08-04. One-time backfill for the CITY_FALLBACK_AR
-- double-normalize bug fixed in scrapers/dealapp/run.py (_resolve_city()): the code fix only
-- covers FUTURE scrapes. dealapp_residential_listings.city/region are written once at scrape
-- time (not derived at query time), so the 129 already-scraped rows need a direct backfill.
-- Narrow, exact match on the same 3 city_ar values the bug affected -- can never misfire on any
-- other row (mirrors the Python fix's own safety guarantee).
with fb(city_ar, city_en, region_en) as (
  values ('ضرما','Riyadh','Riyadh'), ('قرية العليا','Hafar Al Batin','Eastern Province'), ('عسفان','Jeddah','Makkah')
)
update dealapp_residential_listings r
set city = fb.city_en, region = fb.region_en
from fb
where r.city is null and r.additional_info->>'city_ar' = fb.city_ar;

-- Re-run the existing English->Arabic city overlay resolver so the now-populated city/region
-- flows into listings_arabic_locations (dealapp has no native branch in
-- listing_native_location_v1; it resolves via this overlay + the "legacy" CTE).
select resolve_english_city_overlay();
