-- 🆕 New Listings 10-18 (contract G, backlog #657): unknown named districts, batch 1 of the 10-18 alarm
-- (unknown_named_district 06:50 UTC: 370 names / 3,121 ads). Same admission rule as 20261011133138 and
-- 20261018035154: ≥ 3 distinct active ads name it in the source's own district field or «بحي X», not a
-- city/village in loc_catalog_city, not a plan / direction / number, not a spelling of a catalogued district
-- of that city; spelling = the source's own form. No listing row is written here: the hourly district
-- recovery (:10) and the next crawl re-resolve through the sanctioned resolver.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (6,  'حي الشامية الجديد'),   -- مكة: muhaysini 67 + sakan 26 («أرض تجارية للبيع في الشامية الجديدة، مكة»)
    (6,  'حي القشاشية الجديد'),  -- مكة: muhaysini 29
    (13, 'حي الشروق'),           -- الدمام: muhaysini 47
    (15, 'حي الغدير'),           -- أبها: muhaysini 24
    (3,  'حي ضاحية خزام'),       -- الرياض: eilmalriyada 66
    (11, 'حي التوفيق'),          -- بريدة: muhaysini 28 (20 + «حي التوفيق» titles)
    (11, 'حي الإزدهار'),         -- بريدة: muhaysini 23
    (11, 'حي الزيتونة'),         -- بريدة: muhaysini 18
    (11, 'حي الواحة'),           -- بريدة: muhaysini 15
    (11, 'حي خب الجطيلي')        -- بريدة: muhaysini 11 (the city already holds خب البريدي, خب الثنيان)
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;

-- Names that are NOT admitted, with the why (so the alarm stops re-raising them).
insert into public.ops_district_name_decision (city_id, name_norm, decision, why)
select v.city_id, public.norm_district_tok(v.name), v.decision, v.why
from (values
    (5,    'الطائف',    'rejected', 'the city''s own name, not a district (sokok 72)'),
    (2777, 'مركز',      'rejected', 'generic word «centre», not a district name (sadiqeltajer 24)'),
    (11,   'الجراد',    'rejected', 'may be the catalogued «حي الجردة» — ambiguous (sadiqeltajer 27)'),
    (11,   'الوسيطي',   'variant',  'spelling of the catalogued «حي الوسيطا» — map in the sadiqeltajer scraper, never add (39)'),
    (6,    'أم الجود',  'variant',  'part of the catalogued «حي الحمراء وام الجود» — map in the muhaysini scraper, never add (22)'),
    (31,   'الشفاء',    'rejected', 'also a town name in loc_catalog_city (الشفا 14519), admission rule (muhaysini 37)'),
    (11,   'الشفاء',    'rejected', 'also a town name in loc_catalog_city (الشفا 14519), admission rule (sadiqeltajer 34)'),
    (3,    'المعيزيلة', 'rejected', 'also a town name in loc_catalog_city (1241), admission rule (sakan 46)'),
    (5,    'الرحبة',    'rejected', 'also a town name in loc_catalog_city (2052), admission rule (muhaysini 29, sakan 26)'),
    (11,   'المنصورة',  'rejected', 'also a town name in loc_catalog_city (2740), admission rule (muhaysini 14)'),
    (11,   'السليمانية','rejected', 'also a town name in loc_catalog_city (3679), admission rule (muhaysini 14)')
) as v(city_id, name, decision, why)
on conflict (city_id, name_norm) do nothing;

-- Check block: every admitted name is in its city's catalog (resolve_district_ar reads loc_canonical_district,
-- which refresh_loc_canonical_district rebuilds from this catalog at :10).
do $$
declare k int;
begin
  select count(*) into k from public.loc_catalog_district
   where (city_id, district_norm) in ((6, public.norm_district_tok('الشامية الجديد')), (3, public.norm_district_tok('ضاحية خزام')),
                                      (11, public.norm_district_tok('خب الجطيلي')), (13, public.norm_district_tok('الشروق')));
  if k <> 4 then raise exception 'only % of 4 probe names are catalogued', k; end if;
  select count(*) into k from public.ops_district_name_decision where city_id = 5 and name_norm = public.norm_district_tok('الطائف');
  if k <> 1 then raise exception 'decision for الطائف missing'; end if;
end $$;
