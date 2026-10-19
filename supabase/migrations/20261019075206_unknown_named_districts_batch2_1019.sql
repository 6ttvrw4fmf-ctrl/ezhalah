-- 🆕 New Listings 10-19 (contract G, #657), batch 2: the next names outside the الاحساء governorate cluster (#659),
-- measured 07:40 UTC after batch 1 (167 names / 920 ads). Same admission rule as 20261018073107.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (12, 'حي الفاضلية'),   -- الهفوف: aljassim 7 («بيت جاهز للبيع في الفاضلية»)
    (62, 'حي الورود')      -- خميس مشيط: muhaysini 5 («دور للبيع في الورود، خميس مشيط»)
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;

insert into public.ops_district_name_decision (city_id, name_norm, decision, why)
select v.city_id, public.norm_district_tok(v.name), v.decision, v.why
from (values
    (1061, 'مجمع الخرج أفنيو - مدينة الخرج', 'rejected', 'a shopping-centre name, not a district (wslnaa 17)'),
    (3504, 'الفنار',     'rejected', 'the ads mean بحرة in منطقة مكة, filed under Jazan''s بحرة (3504) — a city misfiling, backlog #198 (sakan 4, tuba 4)'),
    (67,   'المصيف',     'rejected', 'the ads place it in صفوى («شقة - صفوى - المصيف»), not القطيف — a city misfiling (muhaysini 3, sakan 3, tuba 3)'),
    (3542, 'المروج',     'rejected', 'given as an alias of «الركوبه» («فيلا - صامطة - الركوبه (المروج)») — ambiguous (muhaysini 5, sakan 3)'),
    (939,  'الميداء',    'rejected', 'the titles say «المليداء» (a بريدة-area name) while the city is البصر — ambiguous spelling and city (muhaysini 7)'),
    (2038, 'ضاحيه الامير سلطان بالعيون', 'rejected', 'the catalog holds North and South «ضاحية الامير سلطان» — which one is not stated (bossbih 5)'),
    (62,   'الحضارى',    'rejected', 'a plan label («مخطط غرب مخطط حسام (الحضارى )»), not a district (muhaysini 3, sakan 3)'),
    (18,   'KSA',        'rejected', 'the country, not a district (rightcompound 7)'),
    (113,  'KSA',        'rejected', 'the country, not a district (rightcompound 7)'),
    (12,   'شارع النجاح', 'rejected', 'a street, not a district (aljassim 4)')
) as v(city_id, name, decision, why)
on conflict (city_id, name_norm) do nothing;

do $$
declare k int;
begin
  select count(*) into k from public.loc_catalog_district
   where (city_id, district_norm) in ((12, public.norm_district_tok('الفاضلية')), (62, public.norm_district_tok('الورود')));
  if k <> 2 then raise exception 'only % of 2 admitted names are catalogued', k; end if;
  select count(*) into k from public.ops_district_name_decision
   where city_id = 3504 and name_norm = public.norm_district_tok('الفنار');
  if k <> 1 then raise exception 'decision for بحرة الفنار not recorded'; end if;
end $$;
