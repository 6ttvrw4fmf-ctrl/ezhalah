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