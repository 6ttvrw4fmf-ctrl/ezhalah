-- Companion to amlakalahsa_jafr_dahiya_districts_merged_to_one: search_listings_ar is a denormalized
-- INDEX synced from listing_native_location_v2 (itself reading district_ar from the materialized
-- view listing_native_location_v1), not a live passthrough of the raw table — so the base-table
-- rename alone does not reach it until the next sync. sync_search_listings_ar() times out via this
-- connector on a full fleet-wide run (same statement-timeout class as the listing_extra_attrs fix,
-- migration 20260913025049), so this backfills just the 32 affected rows directly instead — byte-
-- identical result to what the next scheduled sync would have written, verified before applying
-- (search_listings_ar's own district_ar for these 32 rows already matched the base table's new
-- value once listing_native_location_v1 was refreshed; this statement is the same correction,
-- applied directly to the search index in the meantime).
update public.search_listings_ar
set district_ar = 'الضاحية'
where city_ar = 'الجفر' and source_table = 'amlakalahsa_residential_listings' and district_ar like 'الضاحية%';