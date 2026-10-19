-- §25a (2026-09-18). The fourth run at the wasalt "x1000 land prices" reached the same verdict as
-- §25: wasalt publishes these figures. NO PRICE IS CHANGED HERE. Only the evidence rows are added,
-- and the visibility flag they release.
--
-- Why these three needed a live read rather than §25's archived oracle: all three were scraped
-- 2026-09-17 by the new browser transport (#3129) and their ar_data is NULL, because enrich_ar.py is
-- still on the Cloudflare-blocked HTTP path. A settled class does not settle a row the oracle cannot
-- see, so each was read directly from wasalt.sa on 2026-09-18 with all four corroborants agreeing.
--
-- NOTE for mon_detect_price_source_evidence_stale(): these rows have no ar_data, so its wasalt branch
-- yields NULL and counts them as not_recheckable -- deliberately not judged, which is the documented
-- treatment for live-probe evidence. When enrich_ar is fixed they become machine-checkable and will
-- match, since the archived salePrice is the figure recorded below.

insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select v.source_table, v.listing_id, v.evidence, now()
  from (values
    ('wasalt_residential_listings', 11939802::bigint,
     'salePrice=conversionPrice=24829872186, currencyType=conversionUnit=SAR, wasalt''s own '
     'averageSalePricePerSqm=7046000 at the SAME magnitude, carpetArea="3523.967" (our area_m2=3523 '
     'is that value truncated), and wasalt''s own prose "Land Area: 3523.967 SQM ... Price: '
     '24829872186 SAR" verbatim. Read live from wasalt.sa 2026-09-18 via __NEXT_DATA__ '
     'props.pageProps.propertyDetailsV3.propertyInfo; ar_data is NULL (scraped by the #3129 browser '
     'sweep before enrich_ar could archive it). Source-published.'),
    ('wasalt_residential_listings', 11939808::bigint,
     'salePrice=conversionPrice=4183393680, currencyType=conversionUnit=SAR, wasalt''s own '
     'averageSalePricePerSqm=5784000 at the SAME magnitude, carpetArea="723.27" (our area_m2=723 is '
     'that value truncated), and wasalt''s own prose "Land Area: 723.27 SQM ... Price: 4183393680 '
     'SAR" verbatim. Read live from wasalt.sa 2026-09-18 via __NEXT_DATA__ '
     'props.pageProps.propertyDetailsV3.propertyInfo; ar_data is NULL (same reason). '
     'Source-published.'),
    ('wasalt_residential_listings', 11939904::bigint,
     'salePrice=conversionPrice=76859520864, currencyType=conversionUnit=SAR, wasalt''s own '
     'averageSalePricePerSqm=3920702 at the SAME magnitude, carpetArea="19603.51" (our '
     'area_m2=19603 is that value truncated), and wasalt''s own prose "Land Area: 19603.51 SQM ... '
     'Price: 76859520864 SAR" verbatim. Read live from wasalt.sa 2026-09-18 via __NEXT_DATA__ '
     'props.pageProps.propertyDetailsV3.propertyInfo; ar_data is NULL (same reason). '
     'Source-published. NOTE: this row also fails location resolution (city_id NULL), so the ungate '
     'below cannot publish it -- the price side is settled, the location side is not.')
  ) as v(source_table, listing_id, evidence)
 where not exists (
   select 1 from public.ops_price_source_verified o
    where o.source_table = v.source_table and o.listing_id = v.listing_id);

-- The ungate, exactly the shape of 20260828225740. enforce_price_size_sanity() forces
-- production_ready=false but never sets it back to true, so an already-false row needs one touch to
-- re-fire the trigger -- which now finds the evidence row and leaves the flag alone.
--
-- The join on listing_native_location_v2 is load-bearing: it is what stops a PRICE adjudication from
-- publishing a row that failed LOCATION resolution. 11939904 is filtered out by it, on purpose.
update public.search_listings_ar s
   set production_ready = true
  from public.listing_native_location_v2 v
 where v.source_table = s.source_table
   and v.listing_id   = s.listing_id
   and v.production_ready
   and not s.production_ready
   and s.region_id is not null
   and s.city_id is not null
   and s.source_table = 'wasalt_residential_listings'
   and s.listing_id in (11939802, 11939808, 11939904);
