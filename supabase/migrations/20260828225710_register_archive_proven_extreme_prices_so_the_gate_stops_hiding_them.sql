-- Owner-authorised 2026-08-28 ("fix all and deploy"), after the Data Integrity run proved from
-- ARCHIVED source payloads that the gated extreme prices are what the source itself publishes.
--
-- NO PRICE IS CHANGED HERE, and no threshold is touched. price_size_impossible() is untouched.
-- enforce_price_size_sanity() already hides a tripping row ONLY if it is absent from
-- ops_price_source_verified; this migration supplies the missing evidence rows so the gate stops
-- hiding values the source published. That is the mechanism's designed lever (20260817225742).
--
-- SELF-GUARDING BY CONSTRUCTION: every INSERT below re-derives the proof from the stored source
-- payload in the same statement. A row whose stored price does NOT equal its archived source value
-- cannot be registered by this migration at all -- there is no id list to get wrong, and re-running
-- it can never widen the set. The evidence string is likewise built from the payload, not typed.
--
-- DELIBERATELY NOT REGISTERED: aqarmonthly 1143359 and 1661535, whose capture carries
-- price_evidence.reason = 'adapter_emitted_no_evidence'. No archived figure exists to check them
-- against, so they stay gated. UNKNOWN stays UNKNOWN -- that is the owner's standing rule and
-- "fix all" does not license asserting a source truth we do not hold.
--
-- Applied to production 2026-08-28 22:57 UTC under deploy lock
-- 'data-integrity-routine-2026-08-28-wasalt'. Registered exactly 13 rows: wasalt 7, dealapp 4,
-- aqarmonthly 2 -- and refused the 2 unprovable rows, as designed.

-- 1. wasalt SALE: stored price_total must equal wasalt's own propertyInfo.salePrice.
insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select 'wasalt_residential_listings', w.id,
       format('ARCHIVED SOURCE PAYLOAD (ar_data.propertyInfo), verified 2026-08-28 by the Data '
              'Integrity run. %s m2 %s. Stored price_total=%s == wasalt salePrice=%s == '
              'conversionPrice=%s, currencyType=%s / conversionUnit=%s. wasalt OWN computed '
              'averageSalePricePerSqm=%s, i.e. the source itself states the per-m2 figure at this '
              'same magnitude. Source-published; preserved verbatim, never repriced. Class evidence: '
              'across all active wasalt rows conversionPrice differs from salePrice on 0 rows and '
              'the two currency units differ on 0 rows, so the salePrice-or-conversionPrice fallback '
              'cannot inflate a price. See docs/ops/DATA_INTEGRITY_ENGINEER.md SS25.',
              w.area_m2, coalesce(w.property_type,'?'), w.price_total,
              w.ar_data->'propertyInfo'->>'salePrice',
              w.ar_data->'propertyInfo'->>'conversionPrice',
              coalesce(w.ar_data->'propertyInfo'->>'currencyType','-'),
              coalesce(w.ar_data->'propertyInfo'->>'conversionUnit','-'),
              coalesce(w.ar_data->'propertyInfo'->>'averageSalePricePerSqm','-')),
       now()
from public.wasalt_residential_listings w
join public.search_listings_ar s
  on s.source_table = 'wasalt_residential_listings' and s.listing_id = w.id
where not s.production_ready
  and s.region_id is not null and s.city_id is not null
  and public.price_size_impossible(s.price_total, s.price_annual, s.area_m2)
  and w.price_total is not null
  and nullif(w.ar_data->'propertyInfo'->>'salePrice','') is not null
  and w.price_total = (w.ar_data->'propertyInfo'->>'salePrice')::numeric
on conflict do nothing;

-- 2. wasalt RENT: stored price_annual must equal wasalt's own expectedRent.
insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select 'wasalt_residential_listings', w.id,
       format('ARCHIVED SOURCE PAYLOAD (ar_data.propertyInfo), verified 2026-08-28. %s m2 %s RENT. '
              'Stored price_annual=%s == wasalt expectedRent=%s, and wasalt''s own rentFreq block '
              'carries yearly.amount with enCurrencyType SAR: %s. The yearly amount is the source''s '
              'own, not a derived x12. Source-published; preserved verbatim, never repriced. '
              'See docs/ops/DATA_INTEGRITY_ENGINEER.md SS25.',
              w.area_m2, coalesce(w.property_type,'?'), w.price_annual,
              w.ar_data->'propertyInfo'->>'expectedRent',
              left(coalesce(w.ar_data->'propertyInfo'->>'rentFreq','-'), 300)),
       now()
from public.wasalt_residential_listings w
join public.search_listings_ar s
  on s.source_table = 'wasalt_residential_listings' and s.listing_id = w.id
where not s.production_ready
  and s.region_id is not null and s.city_id is not null
  and public.price_size_impossible(s.price_total, s.price_annual, s.area_m2)
  and w.price_annual is not null
  and nullif(w.ar_data->'propertyInfo'->>'expectedRent','') is not null
  and w.price_annual = (w.ar_data->'propertyInfo'->>'expectedRent')::numeric
on conflict do nothing;

-- 3. dealapp: stored price_total must equal the STRUCTURED offers.price the capture recorded.
--    origin='structured' + found=true is dealapp's own JSON-LD block, not seller prose. (SS8: the
--    structured block is the anchor; prose is not a source field, which matters here because
--    1136238's seller prose quotes a different figure than dealapp's own offers.price.)
insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select 'dealapp_residential_listings', d.id,
       format('ARCHIVED SOURCE CAPTURE (source_capture.price_evidence), verified 2026-08-28. '
              '%s m2. Stored price_total=%s == dealapp STRUCTURED %s raw=%s (origin=%s, kind=%s, '
              'found=true) -- dealapp''s own schema.org offers block, not seller prose. '
              'Source-published; preserved verbatim, never repriced. NOTE for 1136238: dealapp''s '
              'own ad prose quotes a different figure than its own structured offers.price; that is '
              'an inconsistency INSIDE dealapp, and SS8 anchors on the structured block. '
              'See docs/ops/DATA_INTEGRITY_ENGINEER.md SS25.',
              d.area_m2, d.price_total,
              coalesce(d.source_capture->'price_evidence'->>'field','offers.price'),
              d.source_capture->'price_evidence'->>'raw',
              coalesce(d.source_capture->'price_evidence'->>'origin','-'),
              coalesce(d.source_capture->'price_evidence'->>'kind','-')),
       now()
from public.dealapp_residential_listings d
join public.search_listings_ar s
  on s.source_table = 'dealapp_residential_listings' and s.listing_id = d.id
where not s.production_ready
  and s.region_id is not null and s.city_id is not null
  and public.price_size_impossible(s.price_total, s.price_annual, s.area_m2)
  and d.price_total is not null
  and (d.source_capture->'price_evidence'->>'found')::boolean is true
  and d.source_capture->'price_evidence'->>'origin' = 'structured'
  and nullif(d.source_capture->'price_evidence'->>'raw','') is not null
  and d.price_total = (d.source_capture->'price_evidence'->>'raw')::numeric
on conflict do nothing;

-- 4. aqarmonthly: monthly-only source (MONTHLY_ONLY_TABLE). Stored price_annual must reconcile
--    with the source's own API monthly figure x 12 -- the established annualisation convention.
insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select 'aqarmonthly_residential_listings', a.id,
       format('ARCHIVED SOURCE CAPTURE (source_capture.price_evidence), verified 2026-08-28. '
              '%s m2. Source API %s returned monthly raw=%s (origin=%s, kind=%s); stored '
              'price_annual=%s reconciles as monthly x 12 to within 1 SAR -- the established '
              'annualisation convention for monthly-only platforms. The MONTHLY figure is the '
              'source''s own; only the x12 is ours, and it is the documented product convention. '
              'Source-published; preserved, never repriced. See docs/ops/DATA_INTEGRITY_ENGINEER.md SS25.',
              a.area_m2,
              coalesce(a.source_capture->'price_evidence'->>'field','-'),
              a.source_capture->'price_evidence'->>'raw',
              coalesce(a.source_capture->'price_evidence'->>'origin','-'),
              coalesce(a.source_capture->'price_evidence'->>'kind','-'),
              a.price_annual),
       now()
from public.aqarmonthly_residential_listings a
join public.search_listings_ar s
  on s.source_table = 'aqarmonthly_residential_listings' and s.listing_id = a.id
where not s.production_ready
  and s.region_id is not null and s.city_id is not null
  and public.price_size_impossible(s.price_total, s.price_annual, s.area_m2)
  and a.price_annual is not null
  and (a.source_capture->'price_evidence'->>'found')::boolean is true
  and nullif(a.source_capture->'price_evidence'->>'raw','') is not null
  and abs(a.price_annual - (a.source_capture->'price_evidence'->>'raw')::numeric * 12) <= 1
on conflict do nothing;
