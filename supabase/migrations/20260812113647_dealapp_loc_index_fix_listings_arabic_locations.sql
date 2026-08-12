-- Root cause (evidence: EXPLAIN on the loc_rel_upsert_table dealapp-residential dirty-set query showed
-- cost=112,829,527.98 for 665 candidate rows). listing_native_location_v2's dealapp catchall UNION
-- branch does a LATERAL correlated lookup into listings_arabic_locations filtered on (source_table,
-- listing_id, matched, city_ar) with NO usable index — confirmed via pg_indexes (only city_ar/matched/
-- raw_city_en/region_ar/pkey(index_id) existed), forcing a full Seq Scan of the table inside a
-- per-candidate-row nested loop. This is the dominant cost driver behind the loc_rel/audit-counts
-- statement-timeout failures on dealapp (jobid 22, jobid 50) documented in GH issue #505 comment
-- (2026-08-12).
create index if not exists ix_listings_arabic_locations_source_listing
  on public.listings_arabic_locations (source_table, listing_id);
