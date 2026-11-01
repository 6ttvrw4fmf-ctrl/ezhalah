-- 🔧 Quality & Repair 2026-10-12: the two REAL served-district contradictions left once
-- mon_district_contradicts_source learned the hajar spellings (20261012134024). Both come from the
-- frozen listings_arabic_locations snapshot that listing_native_location_v1 falls back to; the repair
-- is the one the alert itself prescribes: copy the source row's own fields into that table, let the
-- 20-past refresh of listing_native_location_v1 and the :22 sync carry it to the card.
-- SOURCE IS TRUTH, read 2026-10-12 13:52 UTC from the source rows:
--   aqar_residential_listings 15117268: neighborhood «حي الحزم», city «Riyadh», listing URL
--     sa.aqar.fm/شقق-للإيجار/الرياض/غرب-الرياض/حي-الحزم/… (city and district agree three ways);
--     the snapshot served «الدرعية / حي الخالدية», which the source never published.
--     حي الحزم is a catalog district of الرياض.
--   mustqr_residential_listings 615134: neighborhood «درة الضاحية» = additional_info.district_ar
--     «درة الضاحية», city «Hail»; the snapshot served «السويفلة». The source's own word is served.
-- Nothing else moves; both rows stay in their deal/type/price exactly as the source has them.
update public.listings_arabic_locations l
   set raw_city_en = 'Riyadh', city_ar = 'الرياض',
       raw_district = 'حي الحزم', district_ar = 'حي الحزم',
       review_reason = coalesce(review_reason || ' | ', '') || '🔧 2026-10-12 source re-read: city Riyadh, district حي الحزم (was الدرعية / حي الخالدية)'
 where l.listing_id = 15117268 and l.source_table = 'aqar_residential_listings'
   and exists (select 1 from public.aqar_residential_listings a
                where a.id = 15117268 and a.neighborhood = 'حي الحزم' and a.city = 'Riyadh');

update public.listings_arabic_locations l
   set raw_district = 'درة الضاحية', district_ar = 'درة الضاحية',
       review_reason = coalesce(review_reason || ' | ', '') || '🔧 2026-10-12 source re-read: district درة الضاحية (was السويفلة)'
 where l.listing_id = 615134 and l.source_table = 'mustqr_residential_listings'
   and exists (select 1 from public.mustqr_residential_listings m
                where m.id = 615134 and m.neighborhood = 'درة الضاحية'
                  and m.additional_info->>'district_ar' = 'درة الضاحية');