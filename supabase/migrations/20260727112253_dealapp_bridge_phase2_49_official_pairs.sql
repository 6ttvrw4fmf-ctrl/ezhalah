-- dealapp bridge-expansion PHASE 2 — 2026-07-27 (owner-approved, two risk tiers).
-- 49 English→Arabic district pairs for dealapp forms absent from bridge_en_district, each proven
-- against the OFFICIAL KSA location dataset (sa-locations.json = the source loc_catalog_district was
-- seeded from), scoped to the listing's own resolved city, with EXACTLY ONE official match:
--   TIER 1 (41 rows): dealapp's English == the official dataset name verbatim (norm_en equal).
--   TIER 2 (8 rows): consonant-skeleton match (transliteration variants: Ju'ranah→جعرانة,
--     dHRAFAH→الظرفة, waffa→الوفاء…), each with exactly one official candidate in its city.
-- SQL preflight proved: 0 global en_norm collisions (no existing bridge resolution flips to
-- ambiguous), 0 intra-batch collisions, and all 49 Arabic names ALREADY city-attested in
-- loc_canonical_district — so bridge rows alone complete resolve_district_ar's chain; no catalog
-- writes. Rejected & kept NULL: 42 no-match forms (~522 listings) + 10 junk (plans/industrial/
-- university, ~92). Raw source text stays untouched in dealapp_residential_listings (auditability).
-- Idempotent: ON CONFLICT on the (district_en, district_ar) PK does nothing on re-run.
-- Permanent tests: scripts/verify-dealapp-bridge.ts (wired into npm test).
insert into public.district_name_bridge (district_en, city_en, district_ar, n)
values
  -- ── TIER 1: exact official-name matches ─────────────────────────────────────
  ('Al Haylah Al Gharbi Dist.','محايل','حي الحيلة الغربي',24),
  ('Al Hajlah Dist.','مكة المكرمة','حي الهجلة',24),
  ('Al Usaylah Dist.','مكة المكرمة','حي العسيلة',22),
  ('Shaib Amir And Shaib Ali Dist.','مكة المكرمة','حي شعب عامر وشعب علي',21),
  ('Ray Zakhir Dist.','مكة المكرمة','حي ريع زاخر',19),
  ('Ash Shubaikah Dist.','مكة المكرمة','حي الشبيكة',12),
  ('Ash Shuhada Dist.','مكة المكرمة','حي الشهداء',12),
  ('Abu Main Dist.','صفوى','حي ابو معن',11),
  ('Talah Dist.','مدينة الملك عبدالله الاقتصادية','حي التالة',11),
  ('Sharai Al Mujahidin Dist.','مكة المكرمة','حي شرائع المجاهدين',10),
  ('Ar Riyadi Dist.','عنيزة','حي الرياضى',9),
  ('Al Haylah Ash Sharqi Dist.','محايل','حي الحيلة الشرقي',7),
  ('Al Haram Dist.','مكة المكرمة','حي الحرم',7),
  ('Ar Rakubah Dist.','صامطة','حي الركوبة',7),
  ('An Nuqailiah Dist.','عنيزة','حي النقيلية',6),
  ('Abu As Sala','صبيا','ابو السلع',6),
  ('Al Maqaiid Dist.','محايل','حي المقاعد',5),
  ('Al Ghuwayla B','نجران','حي الغويلا ب',5),
  ('Al Arjeen','صبيا','العرجين',5),
  ('Ad Diyafah Dist.','مكة المكرمة','حي الضيافة',4),
  ('Al Bibyan Dist.','مكة المكرمة','حي البيبان',4),
  ('Ar Ruwaihah Dist.','صفوى','حي الرويحة',4),
  ('Gharb An Nabiyah Dist.','سيهات','حي غرب النابية',4),
  ('Al Misfalah Dist.','مكة المكرمة','حي المسفلة',4),
  ('Hareer Dist.','مدينة الملك عبدالله الاقتصادية','حي الحرير',4),
  ('Al Idhaah Dist.','عفيف','حي الاذاعة',3),
  ('As Samad Dist.','رابغ','حي الصمد',3),
  ('Al Dhabyah Dist.','صبيا','حي الظبية',2),
  ('Rabwat Al Hajeb Dist.','عنيزة','حي ربوة الحاجب',2),
  ('Al Kada Dist.','عنيزة','حي الغضا',2),
  ('Tayib Al Ism Dist.','خميس مشيط','حي طيب الاسم',2),
  ('Al Mansuriyah Dist.','عرعر','حي المنصورية',2),
  ('Al Musaidiyah Dist.','عرعر','حي المساعدية',2),
  ('AL-AGHAR','رنية','حي الأغر',2),
  ('Tanmiyah Dist.','مدينة الملك عبدالله الاقتصادية','حي التنمية',2),
  ('An Nabiyah Dist.','سيهات','حي النابية',2),
  ('Al Muutarid Dist.','صبيا','حي المعترض',1),
  ('Jukhairah Dist.','صبيا','حي جخيرة',1),
  ('Al Qararah And An Naqa Dist.','مكة المكرمة','حي القرارة والنقا',1),
  ('Al Jamieyah','عفيف','الجامعية',1),
  ('As Silayyib Al Gharbi Dist.','رابغ','حي الصليب الغربي',1),
  -- ── TIER 2: consonant-skeleton matches (exactly-one official candidate each) ─
  ('Al Ju''ranah','مكة المكرمة','حي جعرانة',90),
  ('Al-dHRAFAH','خميس مشيط','حي الظرفة',37),
  ('al-waffa','خميس مشيط','حي الوفاء',13),
  ('ALOMARAH','خميس مشيط','حي المعمورة',12),
  ('al-wissam','خميس مشيط','حي الوسام',7),
  ('al-raqy','خميس مشيط','حي الراقي',4),
  ('shkar','خميس مشيط','حي شكر',2),
  ('almaamorah','خميس مشيط','حي المعمورة',1)
on conflict (district_en, district_ar) do nothing;
