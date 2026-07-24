-- Bucket-B gathern district seed — 2026-07-24 (owner-approved: "match the ones that are real districts").
-- Follow-up to the «حي X» bucket-A seed (20260721112816). Bucket B = bare-name source districts. To avoid
-- guessing which of the 94 tokens are real districts, each row here carries FORMAT-INDEPENDENT PROOF:
--   • the same normalized name is already a catalog district in ANOTHER city (district-shaped, e.g.
--     حجلة→حي حجله, النسيم→حي النسيم, الدانة→حي الدانة), AND
--   • it is NOT a city/town name (excludes المبرز/بلجرشي/سكاكا/… — 38 such tokens stay unmatched), AND
--   • it doesn't equal the row's own city name.
-- Gathern's own per-listing assignment then attests it for its city. 38 no-evidence tokens (villages/
-- rural free-text) stay honestly NULL. district_ar = EXACT gathern source spelling; district_norm =
-- normalize_ar (catalog convention). Last row: «حي المطار القديم» (عرعر) — a bucket-A-criteria «حي» name
-- that the landmark keyword filter ('مطار') caught by accident; real district, owner-flagged 07-21.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.normalize_ar(v.district_ar)
from (values
    (3,    'النسيم'),
    (10,   'حي عقده'),
    (12,   'البستان'),
    (12,   'الحزم الشمالي'),
    (12,   'الحزم الجنوبي'),
    (13,   'الضاحيه'),
    (15,   'حجلة'),
    (15,   'البصرة'),
    (62,   'التحليه'),
    (115,  'البستان'),
    (199,  'الاسكان'),
    (227,  'الدانة'),
    (294,  'الياسمين'),
    (500,  'وسط البلد'),
    (1862, 'المديري'),
    (2213, 'حي المطار القديم'),
    (3462, 'النهضة')
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;
