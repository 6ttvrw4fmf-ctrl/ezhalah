-- Seed 69 gathern-attested «حي» districts into the canonical catalog — 2026-07-21 (owner-approved, A-first).
--
-- WHY: after the gathern district-recovery arm (20260721105827), ~1,097 monthly gathern listings still had a
-- NULL district because their source district (gathern additional_info->>'district_ar') was a real neighborhood
-- our catalog simply didn't know — concentrated in smaller/tourism cities gathern covers heavily
-- (تبوك/أبها/الباحة/عرعر/ضبا/نجران/…). Of the 192 distinct free-text tokens, this seeds ONLY the 84-token
-- «حي X» bucket (explicit district marker, non-landmark), deduped to 69 (city_id, district) pairs that have a
-- resolved city_id (never guessed). Bucket B (bare names — mix of districts + towns) and bucket C
-- (roads/landmarks/plan-numbers) are intentionally EXCLUDED.
--
-- HOW (faithful): each row's district_ar is the EXACT gathern source spelling; district_norm uses normalize_ar
-- (the catalog's own char-normalizer — verified to 100% reproduce every existing district_norm). city_id is the
-- listing's already-resolved city. Once catalogued, refresh_loc_canonical_district() recomputes the canonical key
-- as norm_district_tok(district_ar) (which strips «حي»/«ال»), so resolve_district_ar matches gathern's source and
-- the existing gathern recovery arm populates the index — matchable + district-picker-consistent. Static VALUES
-- list (auditable, no live-data drift). ON CONFLICT DO NOTHING (verified 0 collisions with the existing catalog).
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.normalize_ar(v.district_ar)
from (values
    (1, 'حي السبخة'),
    (1, 'حي الظهرة'),
    (1, 'حي المروج - ب'),
    (1, 'حي مروج الأمير'),
    (5, 'حي العرفاء'),
    (6, 'حي  السبهاني'),
    (6, 'حي الاسكان'),
    (10, 'حي الشبيلي الشرقي'),
    (10, 'حي الشبيلي الغربي'),
    (11, 'حي النقيب'),
    (11, 'حي سلطانة الغربية'),
    (12, 'حي السلام'),
    (12, 'حي المسعودي'),
    (12, 'حي المنصورة'),
    (12, 'حي عين نجم'),
    (14, 'حي الجرف الشرقي'),
    (14, 'حي الربوة'),
    (14, 'حي الشرق'),
    (14, 'حي شرق المدينة'),
    (15, 'حي الرهوة'),
    (15, 'حي الشرف'),
    (15, 'حي المعالي'),
    (15, 'حي الورود'),
    (15, 'حي طبب'),
    (15, 'حي عتود'),
    (18, 'حي التوفيق'),
    (18, 'حي التيسير'),
    (31, 'حي السيف'),
    (31, 'حي الصفا'),
    (47, 'حي الذيبية'),
    (47, 'حي القيصومة'),
    (62, 'حي الهر ير'),
    (62, 'حي تندحه'),
    (65, 'حي الواديين'),
    (80, 'حي الشرقية'),
    (80, 'حي هلالة'),
    (115, 'حي الزهور'),
    (199, 'حي العلا'),
    (199, 'حي المعتدل'),
    (443, 'حي الجامع'),
    (483, 'حي التاخي'),
    (483, 'حي عين النوى'),
    (483, 'حي ينبع الصناعية'),
    (990, 'حي الجو'),
    (1061, 'حي الفرسان'),
    (1061, 'حي المحمديه'),
    (1531, 'حي البركة'),
    (1531, 'حي الحمران'),
    (1531, 'حي المصنعة'),
    (1531, 'حي ببنى كبير'),
    (1542, 'حي الحكمان'),
    (1947, 'حي الضاحية'),
    (2213, 'حي الضاحية'),
    (2213, 'حي المروج'),
    (2237, 'حي الامل'),
    (2237, 'حي قارا'),
    (2256, 'حي النموذجية جنوب'),
    (2421, 'حي النسيم'),
    (2464, 'حي سفايا'),
    (2481, 'حي القدس الزراعي'),
    (2519, 'حي الفرعة الشمالية'),
    (2519, 'حي حلباء'),
    (2630, 'حي المنار'),
    (2835, 'حي عويرة'),
    (3417, 'حي حبونا'),
    (3417, 'حي شرق الضباط'),
    (3462, 'حي الخالدية'),
    (3504, 'حي الاصالة'),
    (3666, 'حي الشروق')
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;
