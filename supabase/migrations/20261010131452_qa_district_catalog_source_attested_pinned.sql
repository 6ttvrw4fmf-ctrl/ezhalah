-- 🔧 Quality & Repair 2026-10-10 (track A, no-district older listings): thirteen districts that dealapp / aqar
-- state in their own structured neighbourhood field were missing from loc_catalog_district for the ad's
-- city, so resolve_district_ar() (catalog ∪ live attestation only, never invents) left 80 searchable ads
-- with no district and a customer who picks the district never found them.
-- Admitted only when ALL hold (measured 2026-10-10 13:40 UTC): ≥ 3 distinct ads name it; every ad carries
-- its own map pin (distinct pins, not a city-centre default) within 12 km of the city's median pin; the name
-- is not a city/village name anywhere in loc_catalog_city, not a plan («مخطط»), farm («مزارع») or village
-- («قرية»/«هجرة») label, has no number, and district_ar_looks_bogus() is false. Spelling = the source's own
-- most frequent form. Deliberately NOT added: الفرحانية (حائل, pins 77 km out), عقرباء / البطين (الرياض,
-- 29 / 60 km out), العدل (الغزالة, 60 km), ديراب / الذيبية / قصور آل مقبل (المزاحمية, outlying villages),
-- مختارة (احد المسارحة, routed 10-08 as possibly صامطة), العسيلة (also a city).
-- Dry run (rolled back): 0 of these ads resolved before, 80 after (dealapp 77, aqar 3); nothing else moves
-- (city-scoped; none of these cities is in loc_city_cluster). No listing row is written here: the hourly
-- district-recovery pipeline (:10) re-resolves through the sanctioned resolver and the :22 sync serves it.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (15,   'حي المعارض'),
    (15,   'حي شعبة الشيخ'),
    (15,   'حي الفيصلي'),
    (3174, 'حي الملك عبدالله'),
    (3174, 'حي الأندلس'),
    (115,  'حي الشهداء'),
    (902,  'الجلة الشمالي'),
    (377,  'حي النسيم'),
    (2481, 'حي الجامعة'),
    (62,   'حي أم سرار'),
    (62,   'حي الطلايع'),
    (1801, 'حي الياسمين'),
    (11,   'حي البساتين الشرقي')
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;
