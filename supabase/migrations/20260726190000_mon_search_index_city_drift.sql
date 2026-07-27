-- Stale-search-index guard (2026-07-26).
-- search_listings_ar is a MATERIALIZED SNAPSHOT TABLE that the search RPC (location_search_candidates_ar)
-- reads; it is rebuilt from listing_native_location_v2 (the live location resolver). If that rebuild
-- lags or breaks, the index can attribute a listing to a DIFFERENT city/region than the resolver
-- currently says — the exact defect that briefly put 2 «أبو عريش» (Abu Arish/Jazan) listings under a
-- الرياض city search (it self-healed once the index refreshed). At rest the two layers are identical
-- (verified 0 drift 2026-07-26), so ANY live contradiction here means the index is stale.
--
-- This view exposes every such contradiction; the nightly audit (scripts/check_audit_invariants.py)
-- reads its row count and alerts when it exceeds a small tolerance (transient mid-refresh lag only).
create or replace view public.mon_search_index_city_drift as
select s.source_table, s.listing_id,
       s.city_id   as index_city_id,   n.city_id   as resolved_city_id,
       s.region_id as index_region_id, n.region_id as resolved_region_id
from search_listings_ar s
join listing_native_location_v2 n using (source_table, listing_id)
where (s.city_id   is not null and n.city_id   is not null and s.city_id   <> n.city_id)
   or (s.region_id is not null and n.region_id is not null and s.region_id <> n.region_id);
