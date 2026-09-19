-- Two located_row_unreachable P1s raised 2026-09-18/19, adjudicated against the SOURCE the same way
-- §25a settled the wasalt cohort. NO PRICE IS CHANGED. Evidence rows only, plus the visibility flag
-- they release.
--
-- Both rows were unverifiable from what we had archived, which is WHY they needed a live read:
--   * aqar 12095096   - source_capture.price_evidence.raw held page nav chrome ("تطبيق عقار
--     الإعلانات المشاريع..."), not a price. origin='spec_table' but the captured text evidences
--     nothing. A capture that records the wrong span is not proof, and must not be read as proof.
--   * akariyoun 12049499 - price_evidence is literally {"reason":"adapter_emitted_no_evidence",
--     "unverified":true}. It self-declares that it has none.
--
-- Read live 2026-09-19. Both sources publish the figures we store, and both publish a SECOND,
-- independent figure that agrees at the same magnitude - which is the discriminator that would
-- collapse if OUR value were inflated (a source per-m² ~1000x smaller is what an inflated total
-- looks like; neither shows it).

insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select v.source_table, v.listing_id, v.evidence, now()
  from (values
    ('aqar_residential_listings', 12095096::bigint,
     'aqar''s OWN schema.org JSON-LD on the live page: offers.price=2300000000, '
     'offers.priceCurrency="SAR", itemOffered.floorSize={value:360, unitCode:"MTK"} - machine-'
     'readable structured data, not scraped display text, and it matches stored price_total=2300000000 '
     'and area_m2=360 exactly. The rendered price slot shows "2,300,000,000" as well. Read live from '
     'sa.aqar.fm 2026-09-19 (ad 6876143). NOTE: this row''s own source_capture.price_evidence.raw '
     'captured page navigation chrome instead of the price span - the capture is unreliable here, the '
     'SOURCE is not. Source-published.'),
    ('akariyoun_residential_listings', 12049499::bigint,
     'akariyoun publishes BOTH figures in its own words on the live page: "سعر المتر للأرض : 9.2 '
     'مليون" and "إجمالي سعر البيع : 4.6 مليار", with 4600000000.00 in the markup and المساحة 500 m². '
     'Stored price_total=4600000000 and price_per_meter=9200000 match both, and the source''s own '
     'per-m² is 9.2 MILLION - the same magnitude as total/area, not the ~9,200 that an inflated total '
     'would imply. price_per_meter is parsed from the page by parse_ppm(), independently of the total, '
     'so the two are not the same measurement restated. Read live from akariyoun.sa 2026-09-19 '
     '(AK879). Source-published.')
  ) as v(source_table, listing_id, evidence)
 where not exists (
   select 1 from public.ops_price_source_verified o
    where o.source_table = v.source_table and o.listing_id = v.listing_id);

-- The ungate (shape of 20260828225740 / 20260918220610). enforce_price_size_sanity() forces
-- production_ready=false but never restores it, so an already-false row needs one touch to re-fire
-- the trigger, which now finds the evidence and leaves the flag alone. The listing_native_location_v2
-- join is load-bearing: a PRICE adjudication must never publish a row that failed LOCATION resolution.
update public.search_listings_ar s
   set production_ready = true
  from public.listing_native_location_v2 v
 where v.source_table = s.source_table
   and v.listing_id   = s.listing_id
   and v.production_ready
   and not s.production_ready
   and s.region_id is not null
   and s.city_id is not null
   and (s.source_table, s.listing_id) in
       (('aqar_residential_listings', 12095096), ('akariyoun_residential_listings', 12049499));
