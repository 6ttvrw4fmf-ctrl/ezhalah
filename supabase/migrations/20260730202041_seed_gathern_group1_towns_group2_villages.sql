-- gathern district bridge — owner-approved 2026-07-30 ("do B for group 1 and seed group 2"):
-- GROUP 1 (option B): town/city names sitting in gathern's district slot become districts of the
--   PARENT city the listing already resolves to (السودة stays findable under أبها). 32 forms.
-- GROUP 2: free-text village/district names (source's own Arabic, in no official dataset) seeded
--   verbatim, city-attested. 26 forms.
-- EXACT gathern additional_info->>'district_ar' spellings (resolver keys off norm_district_tok of
-- the raw input — incl. «نعمان.» with its dot). Preflighted: 58 seeds, 0 already-canonical,
-- 0 (city_id, district_norm) collisions, 0 bad cities, 0 intra-batch dups.
-- EXCLUDED (reported, stay NULL): district==own-city forms (8), roads/مخطط/وادي/شاطئ landmarks
-- (bucket C, standing owner rule), compound/sentence strings (~17 forms).
INSERT INTO loc_catalog_district (city_id, district_ar, district_norm)
VALUES
  -- GROUP 1: towns-as-districts of the parent city
  (15,'السودة',normalize_ar('السودة')),                    -- أبها n=41
  (1542,'بني سار',normalize_ar('بني سار')),                -- الباحة n=31
  (1542,'الاطاولة',normalize_ar('الاطاولة')),              -- الباحة n=22 (+9 «الاطاوله» same token)
  (12,'المبرز',normalize_ar('المبرز')),                    -- الهفوف n=16
  (1542,'بلجرشي',normalize_ar('بلجرشي')),                  -- الباحة n=9
  (1542,'الحجرة',normalize_ar('الحجرة')),                  -- الباحة n=7
  (15,'تمنية',normalize_ar('تمنية')),                      -- أبها n=6
  (1542,'المندق',normalize_ar('المندق')),                  -- الباحة n=5
  (199,'الحجر',normalize_ar('الحجر')),                     -- العلا n=4
  (199,'العذيب',normalize_ar('العذيب')),                   -- العلا n=4
  (199,'قراقر',normalize_ar('قراقر')),                     -- العلا n=4
  (15,'الواديين',normalize_ar('الواديين')),                -- أبها n=4
  (15,'السقا',normalize_ar('السقا')),                      -- أبها n=3
  (5,'السيل الصغير',normalize_ar('السيل الصغير')),         -- الطائف n=3
  (1531,'المحمدية',normalize_ar('المحمدية')),              -- بلجرشي n=3
  (15,'عضاضة',normalize_ar('عضاضة')),                      -- أبها n=2
  (65,'النزهه',normalize_ar('النزهه')),                    -- احد رفيده n=2
  (288,'الثمد',normalize_ar('الثمد')),                     -- خيبر n=2
  (1053,'الرايس',normalize_ar('الرايس')),                  -- بدر n=2
  (1531,'العامر',normalize_ar('العامر')),                  -- بلجرشي n=2
  (1542,'العقيق',normalize_ar('العقيق')),                  -- الباحة n=2
  (2835,'النصباء',normalize_ar('النصباء')),                -- المندق n=2
  (3652,'الجروف',normalize_ar('الجروف')),                  -- احد المسارحة n=1
  (1531,'الفيصليه',normalize_ar('الفيصليه')),              -- بلجرشي n=1
  (18,'ذهبان',normalize_ar('ذهبان')),                      -- جدة n=1
  (12,'العمران',normalize_ar('العمران')),                  -- الهفوف n=1
  (1801,'ترقش',normalize_ar('ترقش')),                      -- محايل عسير n=1
  (3236,'ناوان',normalize_ar('ناوان')),                    -- المخواة n=1
  (3462,'الخضراء',normalize_ar('الخضراء')),                -- بيش n=1
  (485,'الفرع',normalize_ar('الفرع')),                     -- العيص n=1
  (777,'المفرق',normalize_ar('المفرق')),                   -- الحناكية n=1
  (3479,'المحلة',normalize_ar('المحلة')),                  -- صبيا n=1
  -- GROUP 2: free-text villages/districts, source's own Arabic verbatim
  (13,'القرية الثانية',normalize_ar('القرية الثانية')),    -- الدمام و سيهات n=30
  (62,'نعمان.',normalize_ar('نعمان.')),                    -- خميس مشيط n=18 (dot kept: resolver token)
  (3455,'العطبة',normalize_ar('العطبة')),                  -- العيدابي n=13
  (18,'سندس',normalize_ar('سندس')),                        -- جدة n=12
  (15,'بالغليظ',normalize_ar('بالغليظ')),                  -- أبها n=7
  (199,'مغيرا',normalize_ar('مغيرا')),                     -- العلا n=6
  (1390,'الفيصلي',normalize_ar('الفيصلي')),                -- الليث n=6
  (15,'قرى ال عاصم',normalize_ar('قرى ال عاصم')),          -- أبها n=6
  (10,'الفجر',normalize_ar('الفجر')),                      -- حائل n=5
  (14,'حمراء الأسد',normalize_ar('حمراء الأسد')),          -- المدينة المنورة n=4
  (15,'الفرعاء',normalize_ar('الفرعاء')),                  -- أبها n=3
  (2226,'الامير عبدالاله أ',normalize_ar('الامير عبدالاله أ')), -- القريات n=3
  (6,'الزايدي التخصصي',normalize_ar('الزايدي التخصصي')),   -- مكة المكرمة n=3
  (3,'الدريهيمة',normalize_ar('الدريهيمة')),               -- الرياض n=3
  (1,'السهبان',normalize_ar('السهبان')),                   -- تبوك n=2
  (15,'ال السريع',normalize_ar('ال السريع')),              -- أبها n=2
  (1531,'قرية الفرح',normalize_ar('قرية الفرح')),          -- بلجرشي n=1
  (3666,'التاله قاردنز',normalize_ar('التاله قاردنز')),    -- مدينة الملك عبدالله الاقتصادية n=1
  (1542,'الكراء',normalize_ar('الكراء')),                  -- الباحة n=1
  (15,'قرية العزيزه',normalize_ar('قرية العزيزه')),        -- أبها n=1
  (1542,'بني سعد',normalize_ar('بني سعد')),                -- الباحة n=1
  (11,'حاضرة',normalize_ar('حاضرة')),                      -- بريدة n=1
  (6,'محبس الجن',normalize_ar('محبس الجن')),               -- مكة المكرمة n=1
  (2819,'جفن الجنوبي',normalize_ar('جفن الجنوبي')),        -- العقيق n=1
  (3666,'مارينا',normalize_ar('مارينا')),                  -- مدينة الملك عبدالله الاقتصادية n=1
  (3,'الغروب',normalize_ar('الغروب'))                      -- الرياض n=1
ON CONFLICT (city_id, district_norm) DO NOTHING;
