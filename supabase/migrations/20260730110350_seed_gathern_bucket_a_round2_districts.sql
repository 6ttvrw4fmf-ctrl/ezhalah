-- gathern bucket-A round 2 (2026-07-30): explicit «حي X» free-text districts from gathern
-- additional_info->>'district_ar' whose city resolved but whose spelling is absent from the catalog.
-- Same owner-approved mechanism as PR#182 (bucket A, version 20260721112816): seed loc_catalog_district
-- with the EXACT gathern spelling (resolver keys off norm_district_tok of the raw input), city-attested,
-- ON CONFLICT DO NOTHING. 10 forms / 17 live listings. Preflighted 2026-07-30: none already-canonical,
-- zero (city_id, district_norm) collisions.
INSERT INTO loc_catalog_district (city_id, district_ar, district_norm)
VALUES
  (1542, 'حي بني هريرة',    normalize_ar('حي بني هريرة')),    -- الباحة n=4
  (1542, 'حي قرن ظبي',      normalize_ar('حي قرن ظبي')),      -- الباحة n=3
  (3666, 'حي الواحة',        normalize_ar('حي الواحة')),        -- مدينة الملك عبدالله الاقتصادية n=2
  (323,  'حي الدقم',         normalize_ar('حي الدقم')),         -- املج n=2
  (1531, 'حي البحري',        normalize_ar('حي البحري')),        -- بلجرشي n=1
  (15,   'حي سماء ابها',     normalize_ar('حي سماء ابها')),     -- أبها n=1
  (15,   'حي المسقي',        normalize_ar('حي المسقي')),        -- أبها n=1
  (15,   'حي المحارث',       normalize_ar('حي المحارث')),       -- أبها n=1
  (2945, 'حي المهلل',        normalize_ar('حي المهلل')),        -- تمنية n=1
  (233,  'حي الدخل المحدود', normalize_ar('حي الدخل المحدود'))  -- الوجه n=1
ON CONFLICT (city_id, district_norm) DO NOTHING;
