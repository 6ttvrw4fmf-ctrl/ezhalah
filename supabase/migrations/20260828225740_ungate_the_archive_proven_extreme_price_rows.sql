-- Second half of the owner-authorised 2026-08-28 change. The evidence rows landed in
-- ops_price_source_verified; this makes the already-written search rows reflect it.
--
-- WHY AN UPDATE IS NEEDED AT ALL: enforce_price_size_sanity() is a BEFORE INSERT OR UPDATE trigger.
-- It forces production_ready := false, but it never sets it back to true -- so a row already sitting
-- at false stays false until something rewrites it. Touching the row re-fires the trigger, which now
-- finds the evidence row and leaves production_ready alone.
--
-- NO PRICE IS CHANGED. Only the production_ready visibility flag moves, and only for rows that
-- (a) are registered as source-proven, and (b) the RESOLVER already considers production_ready
-- (listing_native_location_v2.production_ready) -- so this can never publish a row that failed
-- location resolution or any other eligibility rule. The price/size gate was the sole reason these
-- were hidden.
--
-- The two aqarmonthly rows with price_evidence.reason='adapter_emitted_no_evidence' are absent from
-- ops_price_source_verified and are therefore untouched by this statement -- they stay gated.
--
-- Applied to production 2026-08-28 22:57 UTC under deploy lock
-- 'data-integrity-routine-2026-08-28-wasalt'. Verified after: rows located-but-unreachable fell
-- 15 -> 2 (exactly the two unprovable rows); RPC total_count 208,158 vs index 208,160, a gap of
-- exactly those 2; wasalt 9431461 retrieved through the anon RPC at الرياض / حي العليا with
-- price 7,312,500,000 and area 450 -- its exact source facts; both unprovable rows confirmed still
-- unreachable. No price value changed anywhere.

update public.search_listings_ar s
   set production_ready = true
  from public.listing_native_location_v2 v
 where v.source_table = s.source_table
   and v.listing_id   = s.listing_id
   and v.production_ready
   and not s.production_ready
   and s.region_id is not null
   and s.city_id  is not null
   and exists (select 1 from public.ops_price_source_verified o
                where o.source_table = s.source_table and o.listing_id = s.listing_id);
