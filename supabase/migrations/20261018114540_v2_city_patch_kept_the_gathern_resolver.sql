-- APPLIED 2026-10-18 (owner session). Coordinator 10-18: 20261018113334 rebuilt listing_native_location_v2 from
-- pg_get_viewdef() to serve the المبرز city correction. A rebuild from the LIVE text cannot be a stale copy, but the proof
-- must be on production, not on the file: the gathern overlay must still resolve additional_info->>'district_ar' through
-- resolve_district_ar() (the 2026-10-04 fix), and gathern must not serve more NULL districts than the index did before
-- the patch (34 at the 11:22 UTC sync; the index is the pre-patch surface until the 12:22 sync).
do $$
declare d text; v2_null bigint; idx_null bigint;
begin
  d := pg_get_viewdef('public.listing_native_location_v2'::regclass, true);
  if position('resolve_district_ar' in d) = 0 then
    raise exception 'listing_native_location_v2 lost the gathern district resolver (resolve_district_ar)';
  end if;
  if position('xcc.city_id' in d) = 0 then
    raise exception 'listing_native_location_v2 does not serve the city correction this check is about';
  end if;
  select count(*) into v2_null from public.listing_native_location_v2 where platform = 'gathern' and production_ready and district_ar is null;
  select count(*) into idx_null from public.search_listings_ar where platform = 'gathern' and production_ready and district_ar is null;
  if v2_null > idx_null then
    raise exception 'gathern NULL districts rose after the v2 patch: index % → v2 %', idx_null, v2_null;
  end if;
  raise notice 'v2 keeps the gathern resolver; gathern NULL districts % (index) → % (v2)', idx_null, v2_null;
end $$;
