-- 🔧 Quality & Repair 2026-10-11 (track A, no-district older listings), second batch after 20261010131452:
-- sixteen districts Deal App states in its own structured neighbourhood field were missing from
-- loc_catalog_district for the ad's city, so resolve_district_ar() (catalog ∪ live attestation only,
-- never invents) left 67 searchable ads with no district and a customer who picks the district never
-- found them (1,436 Deal App production_ready rows had no district at 13:35 UTC).
-- Admitted only when ALL hold (measured 2026-10-11 13:38 UTC, same rule as the first batch): ≥ 3 distinct
-- ads name it; ≥ 3 distinct map pins, every pin within 12 km of the city's median pin; the name is not a
-- city/village name anywhere in loc_catalog_city, not a plan («مخطط»), farm («مزارع») or village
-- («قرية»/«هجرة») label, has no number, and district_ar_looks_bogus() is false; the name resolves to
-- nothing today. Spelling = the source's own form. Deliberately NOT added this time: «رح أبو عريش» (a
-- truncated word, 21 ads), «حي العسيله» / «حي فلس» (ابو عريش, also town names), «حي مشرفة» (الخرج, a town
-- name), «حي الميداء» (بريدة, pins 15 km out), «حي الحزم والبطينه» (الخرج, 17 km), «الشرائع الشمالية»
-- (مكة, 28 km), every «مخطط …» and numbered name.
-- No listing row is written here: the hourly district-recovery pipeline (:10, refresh_loc_canonical_district
-- reads this catalog) re-resolves through the sanctioned resolver and the :22 sync serves it.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (946,  'حي الخوير'),      -- شري, 15 ads, 12 pins, ≤ 8.9 km
    (2777, 'النبقية'),        -- الشماسية, 4 ads
    (3030, 'حي البتراء'),     -- النبهانية, 4
    (3035, 'حي العمار'),      -- الخرماء, 4
    (3174, 'حي الريان'),      -- ليلى, 4
    (902,  'حي الجديده'),     -- الجلة وتبراك, 4
    (701,  'حي القاعيه'),     -- البجادية, 4
    (377,  'حي الربوة'),      -- رابغ, 4
    (3479, 'حي الناصرية'),    -- صبيا, 3
    (306,  'حي المنتزة'),     -- الغاط, 3
    (377,  'حي الصفاء'),      -- رابغ, 3
    (1297, 'حي الرابخ'),      -- بارق, 3
    (1297, 'حي العربه'),      -- بارق, 3
    (3174, 'حي النخيل'),      -- ليلى, 3
    (3396, 'حي المنتشر'),     -- حبونا, 3
    (243,  'الراجحة')         -- بقيق, 3
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;