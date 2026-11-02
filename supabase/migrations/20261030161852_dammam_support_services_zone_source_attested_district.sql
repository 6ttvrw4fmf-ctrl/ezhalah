-- 🆕 New Listings Engineer 2026-10-30 (rule G): the last name on unknown_named_districts(3).
-- «منطقة الخدمات المساندة» (الدمام, city 13) is named by THREE independent sites in exactly this spelling:
-- dealapp 4, wasalt 4, manzo 3 (search_listings_ar, 2026-10-30 16:2x UTC; manzo 21173491 / 21173492 /
-- 21173502 carry it in their own «الحي» field and are served with no district). Admission rule
-- (20261011133138 / 20261018035154): ≥ 3 ads, not a town in loc_catalog_city, not a plan, a direction or
-- a number, not a spelling of a catalogued district — unknown_named_districts_checked(3) reads it «new»
-- (no twin), and الدمام's catalog holds no other name for the area (only «حي الصناعية», «حي الصناعية
-- الاولى», «المدينة الصناعية الثانية/الثالثة», «حي ميناء الملك عبدالعزيز», different places).
-- The spelling is the sources' own; nothing is invented.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select 13, 'منطقة الخدمات المساندة', public.norm_district_tok('منطقة الخدمات المساندة')
on conflict (city_id, district_norm) do nothing;

do $$
begin
  if not exists (select 1 from public.loc_catalog_district
                  where city_id = 13 and district_ar = 'منطقة الخدمات المساندة' and retired_at is null) then
    raise exception 'catalog row for منطقة الخدمات المساندة (13) did not land';
  end if;
end $$;
