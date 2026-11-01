-- 🆕 New Listings 10-18 (contract G, #657), batch 2: the next names from the source's own district field
-- (muhaysini / sakan neighbourhood), measured 07:50 UTC. Same admission rule as 20261018073107.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (6,    'حي المسيال الجديد'),   -- مكة: muhaysini 18 + sakan 11
    (113,  'حي إشبيلية'),          -- الجبيل: sakan 14 + muhaysini 12
    (227,  'حي الوسام'),           -- الظهران: muhaysini 14
    (62,   'حي النور'),            -- خميس مشيط: muhaysini 14 + sakan 8
    (62,   'حي المعارض'),          -- خميس مشيط: sakan 9
    (1301, 'حي الأمير عبدالله'),   -- بيشة: muhaysini 12 + sakan 10
    (1257, 'حي الفنار'),           -- الجموم: muhaysini 9
    (11,   'حي المصيف'),           -- بريدة: muhaysini 9
    (11,   'حي المعارض'),          -- بريدة: muhaysini 8
    (3,    'حي الملك سلمان')       -- الرياض: muhaysini 9
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;

insert into public.ops_district_name_decision (city_id, name_norm, decision, why)
select v.city_id, public.norm_district_tok(v.name), v.decision, v.why
from (values
    (6,    'العمرة',    'rejected', 'may be the catalogued «حي العمرة الجديدة» — ambiguous (muhaysini 22)'),
    (18,   'الرغامة',   'rejected', 'may be the catalogued «حي ابرق الرغامة» — ambiguous (muhaysini 9, sakan 8)'),
    (6,    'المحمدية',  'rejected', 'also a town name in loc_catalog_city (707), admission rule (muhaysini 22)'),
    (65,   'المعلاة',   'rejected', 'also a town name in loc_catalog_city (1323), admission rule (muhaysini 20)'),
    (2630, 'الصفاء',    'rejected', 'also a town name in loc_catalog_city (الصفا 14545), admission rule (muhaysini 19)'),
    (2630, 'البيضاء',   'rejected', 'also a town name in loc_catalog_city (آل بيضاء 3358), admission rule (muhaysini 18)'),
    (939,  'ضراس',      'rejected', 'also a town name in loc_catalog_city (923), admission rule (muhaysini 12)'),
    (5,    'السليمانية','rejected', 'also a town name in loc_catalog_city (3679), admission rule (sakan 11, muhaysini 10)'),
    (62,   'الشرف',     'rejected', 'also a town name in loc_catalog_city (3 towns) and near «حي الشرفية» (muhaysini 9, sakan 9)'),
    (11,   'النزهة',    'rejected', 'also a town name in loc_catalog_city (1264, 4848), admission rule (muhaysini 9)'),
    (5,    'القهيب',    'rejected', 'also a town name in loc_catalog_city (2053), admission rule (sakan 9)'),
    (5,    'الرميدة',   'rejected', 'also a town name in loc_catalog_city (1914), admission rule (muhaysini 8)'),
    (1071, 'مشرفة',     'rejected', 'also a town name in loc_catalog_city (5 towns), admission rule (muhaysini 8)'),
    (3417, 'الروضة',    'rejected', 'also a town name in loc_catalog_city (11 towns), admission rule (muhaysini 8)')
) as v(city_id, name, decision, why)
on conflict (city_id, name_norm) do nothing;

do $$
declare k int;
begin
  select count(*) into k from public.loc_catalog_district
   where (city_id, district_norm) in ((6, public.norm_district_tok('المسيال الجديد')), (113, public.norm_district_tok('إشبيلية')),
                                      (1301, public.norm_district_tok('الأمير عبدالله')));
  if k <> 3 then raise exception 'only % of 3 probe names are catalogued', k; end if;
end $$;