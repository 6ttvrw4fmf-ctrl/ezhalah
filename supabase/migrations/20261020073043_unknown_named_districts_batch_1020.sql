-- 🆕 New Listings 10-20 (contract G, #657): the next names outside the الاحساء governorate cluster (#659), measured
-- 07:3x UTC on unknown_named_districts(3) (142 names / 741 ads). Same admission rule as 20261018035154: ≥ 3 distinct
-- active ads name it («حي X» in the title, or the source's own district field), not a town in loc_catalog_city, not a
-- direction, plan or numbered name, no near spelling in that city's catalogue; spelling = the source's own form.
-- No listing row is written here: the hourly district recovery (:10) re-resolves through the sanctioned resolver.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (2467, 'حي اليرموك'),                  -- رياض الخبراء: muhaysini 4 («أرض للبيع في حي اليرموك, مدينة رياض الخبراء»)
    (2467, 'حي الملك سلمان بن عبد العزيز'), -- رياض الخبراء: muhaysini 4 (the source's district field)
    (2467, 'حي طيبة'),                     -- رياض الخبراء: muhaysini 3 («حي طيبة, مدينة رياض الخبراء»)
    (11,   'حي وهطان'),                    -- بريدة: sadiqeltajer 3 + muhaysini 2 («ورشة للإيجار حي وهطان»)
    (11,   'حي مبروكة'),                   -- بريدة: muhaysini 4 + sadiqeltajer 1 («محل للإيجار في حي مبروكة»)
    (11,   'حي الأمن'),                    -- بريدة: muhaysini 3 («فيلا للبيع في، حي الأمن, مدينة بريدة»)
    (11,   'حي ضارج'),                     -- بريدة: muhaysini 3 («أرض للبيع حي ضارج»)
    (11,   'حي الابراج'),                  -- بريدة: sadiqeltajer 4 (the source's district field)
    (11,   'حي المطار'),                   -- بريدة: sadiqeltajer 3 (the source's district field)
    (12,   'حي الاندلس'),                  -- الهفوف: aljassim 5 («بيت جاهز للبيع في الاندلس»)
    (2464, 'حي الأندلس'),                  -- الخفجي: muhaysini 3 («أرض سكنية للبيع في حي الأندلس، الخفجي»)
    (62,   'حي الزاوية'),                  -- خميس مشيط: muhaysini 3 («… حي الزاوية, مدينة خميس مشيط, منطقة عسير»)
    (13,   'حي الصدفة'),                   -- الدمام: dwelleo 3 («فيلا 4 غرف للبيع في حي الصدفة، الدمام»)
    (6,    'حي طوى'),                      -- مكة المكرمة: muhaysini 3 («… حي طوى, مدينة مكة المكرمة»)
    (1531, 'حي الوادي')                    -- بلجرشي: muhaysini 3 («أرض سكنية للإيجار في الوادي، بلجرشي»)
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;

insert into public.ops_district_name_decision (city_id, name_norm, decision, why)
select v.city_id, public.norm_district_tok(v.name), v.decision, v.why
from (values
    (833,  'عقرباء',      'rejected', 'a village (عقرباء), not a district of الجبيلة (muhaysini 4; dealapp files it under الرياض, #365)'),
    (80,   'الغنام',      'rejected', 'possibly a short form of the catalogued «حي الغنامية» — a spelling is mapped in sadiqeltajer only once confirmed (sadiqeltajer 3)'),
    (2213, 'غرناطة',      'rejected', 'the catalog holds «حي غرناطة الشرقي» and «حي غرناطة الغربي» — which one is not stated (goldendeal 3)'),
    (2748, 'السلام ، المبرز', 'rejected', 'the catalog holds «حي السلام الأول» and «حي السلام الثاني» — which one is not stated (alshawaf 4)'),
    (3666, 'الملك عبدالله الاقتصادية', 'rejected', 'the city''s own name, not a district (dallali 4)'),
    (1986, 'حي',          'rejected', 'the bare word «حي» with no name (sadiqeltajer 3)'),
    (11,   'Al Qassim Province', 'rejected', 'the province, not a district (compoundin 5)'),
    (3,    'Riyadh',      'rejected', 'the city, not a district (compoundin 4)'),
    (227,  'KSA',         'rejected', 'the country, not a district (rightcompound 4)'),
    (62,   'call us',     'rejected', 'a contact prompt, not a district (rightcompound 4)'),
    (31,   'Near EXTRA',  'rejected', 'a shop landmark, not a district (rightcompound 5)'),
    (3,    'Near King Saud University', 'rejected', 'a landmark, not a district (rightcompound 4)')
) as v(city_id, name, decision, why)
on conflict (city_id, name_norm) do nothing;

do $$
declare k int;
begin
  select count(*) into k from public.loc_catalog_district
   where (city_id, district_norm) in ((2467, public.norm_district_tok('اليرموك')), (11, public.norm_district_tok('وهطان')),
                                      (12, public.norm_district_tok('الاندلس')), (6, public.norm_district_tok('طوى')),
                                      (1531, public.norm_district_tok('الوادي')));
  if k <> 5 then raise exception 'only % of 5 checked names are catalogued', k; end if;
  select count(*) into k from public.ops_district_name_decision
   where city_id = 833 and name_norm = public.norm_district_tok('عقرباء');
  if k <> 1 then raise exception 'decision for الجبيلة عقرباء not recorded'; end if;
end $$;
