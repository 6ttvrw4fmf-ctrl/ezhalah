-- 🆕 New Listings Engineer 2026-10-27 (rule G / backlog 657, 659): the rest of الهفوف's ضاحية هجر series,
-- and the governorate decisions for the names filed under «الاحساء».
--
-- (1) loc_catalog_district for الهفوف (12) holds only «الضاحية الأول» and «الضاحية الثالث» (admitted
-- 20261009173236). The other ordinals are served under الهفوف in exactly that spelling by 3–5 platforms
-- each (production_ready, 2026-10-27 07:14 UTC): الخامس 124 ads / 5 sites, الثامن 85 / 5, الرابع 83 / 4,
-- الثاني 67 / 4, السابع 55 / 4, التاسع 50 / 3, السادس 47 / 4, الحادي عشر 38 / 5, العاشر 31 / 4. Admission
-- rule (20261011133138 / 20261018035154): ≥ 3 ads, not a town in loc_catalog_city, not a plan, a direction
-- or a bare number, not a spelling of a catalogued district — الهفوف's catalog has no other spelling of
-- these places (only «حي هجر» and «حي التعاون», different places). The series spelling is the one 10-09
-- already chose; no new name is picked here. aljassim's «الضاحية الحي <ordinal>» is folded onto these
-- names by scrapers/aljassim/run.py::dahiya_without_hayy once the catalog row exists.
-- «الضاحية السابع» (55 / 4) is NOT admitted: trg_district_list_guard reads it as the same district as
-- «الضاحية الرابع» (one letter apart, 7th vs 4th). Only the owner may name it through
-- ezhalah.district_guard_ok, so it waits for that and is listed for the owner.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (12, 'الضاحية الثاني'),
    (12, 'الضاحية الرابع'),
    (12, 'الضاحية الخامس'),
    (12, 'الضاحية السادس'),
    (12, 'الضاحية الثامن'),
    (12, 'الضاحية التاسع'),
    (12, 'الضاحية العاشر'),
    (12, 'الضاحية الحادي عشر')
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;

-- (2) «الاحساء» (3677) is the governorate: loc_catalog_district holds 0 districts for it by design, and
-- aqalemhajer / bossbih / shomou / alshawaf file there on the owner's 2026-09-13 ruling (no listing
-- publishes a town). Its district names must never be admitted under 3677 — they belong to الهفوف /
-- المبرز (the 20261018035154 precedent «الدانة»). These ads are NOT lost: the index serves them with a
-- district and the picker offers it (anon replay 2026-10-27: الاحساء + «المحدود» 86 results incl.
-- 21080223, «المنار» 100 incl. 21080249, «ضاحية هجر(الحي الخامس)» 84 incl. 13116287). Placing them
-- under the sub-city is the city-level work of backlog 659 / 894, which stays open.
insert into public.ops_district_name_decision (city_id, name_norm, decision, why)
select 3677, public.norm_district_tok(n.name), 'rejected', v.why
from (values
    ('الضاحية الحي الخامس'), ('الضاحية الحي الثامن'), ('الضاحية الحي السابع'), ('الضاحية الحي التاسع'),
    ('الضاحية الحي السادس'), ('الضاحية الحي الثاني'), ('الضاحية الحي الاول'), ('الضاحية الحي العاشر'),
    ('الضاحية الحي الرابع'), ('الضاحية الحي الثالث'), ('الضاحية الحي التاسع ج'), ('الضاحية الحي التاسع أ'),
    ('الضاحية الحي الثاني عشر ج'), ('الضاحية الثاني عشر (المناهيل) ج'),
    ('الراشدية'), ('منسوب التعليم'), ('منسوب التعليم الثاني'), ('منسوب التعليم الاول'), ('منسوبي التعليم الأول'),
    ('منسوب التعليم ب'), ('منسوب التعليم د'), ('منسوب التعليم ، المطاوعة'),
    ('هجر الثاني'), ('هجر الثالث'), ('المنار'), ('المحدود'), ('المحدود / أ'), ('المحدود / ج'), ('المحدود / د'),
    ('اليحيى'), ('الرابية'), ('فيضة السر'), ('الهاشمية'), ('الورود'), ('البشرى'), ('السبطين'),
    ('دانة الراشدية / أ'), ('دانة الشعبة'), ('عين موسى الصالحية'), ('جوهرة الهادي ،، احد'), ('النزهة / ب'),
    ('الفيصل'), ('درة المطيرفي'), ('الغسانية'), ('الغسانية ٢'), ('بوسحبل'), ('جوهرة النزهة')
) as n(name)
cross join (values ('الاحساء is the governorate (0 catalog districts by design, owner 2026-09-13); its districts belong to الهفوف / المبرز — never admitted under 3677. Served and findable via the index; sub-city placement is backlog 659 / 894.')) as v(why)
on conflict (city_id, name_norm) do nothing;

-- Streets and roads are not districts (owner rule 6), and an English name is never added.
insert into public.ops_district_name_decision (city_id, name_norm, decision, why)
select 3677, public.norm_district_tok(v.name), v.decision, v.why
from (values
    ('شارع النجاح', 'rejected', 'a street, not a district (owner rule 6); alshawaf 7 ads'),
    ('طريق العقير', 'rejected', 'a road, not a district (owner rule 6); bossbih 5 ads'),
    ('خط قطر', 'rejected', 'a road («خط قطر» = the Qatar highway), not a district (owner rule 6); bossbih 3 ads'),
    ('Al Salam', 'variant', 'English «Al Salam» = «السلام» (rightcompound 4 ads; the index already serves it as السلام) — map in the scraper, never add')
) as v(name, decision, why)
on conflict (city_id, name_norm) do nothing;
