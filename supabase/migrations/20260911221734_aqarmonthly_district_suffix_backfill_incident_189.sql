-- ops_incident #189: strip_district_city_suffix() is invoked only at scrape time (using the
-- platform's own name-only city resolution) and in the one-off 2026-08-23 backfill. Neither runs
-- when a listing's city is resolved LATER by the region-scoped fallback (listings_arabic_locations),
-- so a listing whose platform-parser city is NULL (genuinely ambiguous same-name-twin, e.g.
-- المجمعة has 4 catalog twins) but whose fallback-resolved city IS known keeps its glued district
-- suffix forever. sync_search_listings_ar routes district_ar through loc_display_district_ar(),
-- which only does a display-canon lookup — it never calls strip_district_city_suffix.
--
-- SCOPE: exactly the 3 of 4 flagged listings where the fix is fully deterministic from EXISTING
-- source/canonical data (listings_arabic_locations.city_ar, matched=true, region-disambiguated) —
-- verified live before applying:
--   762041: 'حي الامير نايف المجمعة'      -> strip_district_city_suffix(., 'المجمعة') -> 'حي الامير نايف'
--   762272: 'حي الملك عبدالعزيز المجمعة'   -> strip_district_city_suffix(., 'المجمعة') -> 'حي الملك عبدالعزيز'
--   1097370: 'حي الاندلس المجمعة المجمعة'  -> strip_district_city_suffix(., 'المجمعة') -> 'حي الاندلس'
-- (all three: fallback city_ar='المجمعة', matched=true, region_ar='منطقة الرياض' — genuinely
-- disambiguated, not guessed)
--
-- NOT touched: listing 762483 ('حي المجد القرى القري'). Its own listings_arabic_locations row has
-- matched=false, city_ar=NULL, raw_city_en='Other' — NEITHER the platform parser NOR Ezhalah's
-- region-scoped fallback has ever resolved a city for it (the title mentions «بالباحة» in free
-- prose, but inferring a city from a title string would be a guess, not a deterministic mapping
-- from structured source/canonical data — left unfixed, reported as a genuine source-completeness
-- gap needing broader parser/title-mining work, not a taxonomy or mapping decision).
--
-- This backfills the RAW table (upstream of everything) so the fix survives the next hourly
-- refresh of the listing_native_location_v1 matview + sync_search_listings_ar(), rather than being
-- overwritten by them.
update public.aqarmonthly_residential_listings r
   set district_ar = public.strip_district_city_suffix(r.district_ar, l.city_ar)
  from public.listings_arabic_locations l
 where l.source_table = 'aqarmonthly_residential_listings'
   and l.listing_id = r.id
   and l.matched
   and l.city_ar is not null
   and r.id in (762041, 762272, 1097370);

-- Refresh the matview so listing_native_location_v1/v2 pick up the corrected raw value immediately,
-- rather than waiting for the next hourly jobid-17 tick (same command that job already runs
-- unattended every hour, CONCURRENTLY — no new operational risk, just run once now).
refresh materialized view concurrently public.active_listing_ids_v2;
refresh materialized view concurrently public.listing_native_location_v1;

-- Propagate into the served search index now (same as jobid 28's hourly tick).
select public.sync_search_listings_ar();
