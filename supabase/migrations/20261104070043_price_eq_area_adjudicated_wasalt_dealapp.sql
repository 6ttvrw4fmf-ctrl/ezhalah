-- price_eq_area_or_ppm (alert 4031, 3 rows), adjudicated 2026-11-04 against what each source itself publishes.
-- All three are SOURCE-REAL coincidences; Ezhalah did not create them (PRICE = SOURCE). Watched by
-- mon_detect_price_eq_area_waiver_stale (a later price move re-opens the question) and mon_detect_price_eq_area_or_ppm.
--   wasalt 22475699 / 22475721 (عرعر): the stored wasalt payload publishes propertyInfo.salePrice = 630 / 920 and
--     averageSalePricePerSqm = 1, and wasalt's own REGA description says «سعرها 630 ر.س» / «سعرها 920 ر.س» for a
--     630 / 920 m² plot. The site shows that number as the price.
--   dealapp 23622115 (بقعاء): the seller's own text reads «مساحة 200 الف متر - البيع 200 ألف ريال». dealapp's structured
--     offers.price is 40,000,000,000 (= 200,000 typed into the per-m² box × 200,000 m²); we serve the seller's 200,000
--     through the owner-approved meter-box rule (2026-10-28). Price and area are both 200,000 in the seller's own words.
insert into public.ops_price_eq_area_verified (source_table, listing_id, evidence, verified_at, verified_price_total, verified_area_m2)
select v.source_table, v.listing_id, v.evidence, now(), v.p, v.a
  from (values
    ('wasalt_residential_listings', 22475699::bigint, 'Price fidelity 2026-11-04 (alert price_eq_area_or_ppm). SOURCE-REAL: stored wasalt payload of https://wasalt.sa/en/property/land-630-sqm-facing-west-on-20m-width-street-5963874 publishes propertyInfo.salePrice = 630, averageSalePricePerSqm = 1, and its REGA description «مساحة الأرض 630 متر مربع … سعرها 630 ر.س». The source shows 630 as the price (PRICE = SOURCE).', 630::numeric, 630),
    ('wasalt_residential_listings', 22475721::bigint, 'Price fidelity 2026-11-04 (alert price_eq_area_or_ppm). SOURCE-REAL: stored wasalt payload of https://wasalt.sa/en/property/land-920-sqm-5963877 publishes propertyInfo.salePrice = 920, averageSalePricePerSqm = 1, and its REGA description «مساحة الأرض 920 متر مربع … سعرها 920 ر.س». The source shows 920 as the price (PRICE = SOURCE).', 920::numeric, 920),
    ('dealapp_residential_listings', 23622115::bigint, 'Price fidelity 2026-11-04 (alert price_eq_area_or_ppm). SOURCE-REAL coincidence: the seller''s own text on https://dealapp.sa/ar/ad-details/619545 reads «ارض زراعيه بصك مساحة 200 الف متر - البيع 200 ألف ريال». dealapp''s offers.price = 40,000,000,000 is 200,000 typed into the per-m² box × 200,000 m²; we serve the seller''s 200,000 via the meter-box rule (owner 2026-10-28). Price and area are both 200,000 in the seller''s words.', 200000::numeric, 200000)
  ) v(source_table, listing_id, evidence, p, a)
  join public.search_listings_ar s on s.source_table = v.source_table and s.listing_id = v.listing_id
 where s.price_total = v.p and s.area_m2 = v.a
on conflict do nothing;

do $proof$
begin
  if (select count(*) from public.ops_price_eq_area_verified
       where (source_table, listing_id) in (('wasalt_residential_listings', 22475699), ('wasalt_residential_listings', 22475721),
                                            ('dealapp_residential_listings', 23622115))) <> 3 then
    raise exception 'adjudication did not land on all three rows (a served price moved since it was read — re-read the source)';
  end if;
end
$proof$;

select public.mon_detect_price_eq_area_or_ppm();
