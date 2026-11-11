-- Unknown named districts (rule G, new-listings engineer 2026-11-09): «الوادي» and «نجد» in الجبيلة (city 833, منطقة الرياض).
-- unknown_named_districts_checked(3) verdict 'new' (no twin) for both; الجبيلة had NO catalogued district at all, so no
-- spelling of an existing one is possible. Served index on 2026-11-09 07:3x UTC: نجد — muhaysini 3, wasalt 5, reinvest 1;
-- الوادي — muhaysini 4, wasalt 4. The ads' own address lines say «حي نجد, مدينة الجبيلة, منطقة الرياض» (muhaysini
-- 25537668) and «حي الوادي, مدينة الجبيلة, منطقة الرياض» (25537670); their pins sit in two tight clusters inside the town
-- (نجد 24.90-24.91N 46.37E, الوادي 24.91N 46.31E). Neither is a town in loc_catalog_city, a plan, a direction or a number.
-- Same admission rule and «حي X» form as 20261011133138 / 20261018035154. No listing row is written: the hourly district
-- recovery and sync re-resolve through the sanctioned resolver.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select 833, v.d, public.norm_district_tok(v.d)
from (values ('حي الوادي'), ('حي نجد')) as v(d)
where not exists (select 1 from public.loc_catalog_district
                   where city_id = 833 and district_norm = public.norm_district_tok(v.d));

do $chk$
begin
  if (select count(*) from public.loc_catalog_district
       where city_id = 833 and district_ar in ('حي الوادي', 'حي نجد') and retired_at is null) <> 2 then
    raise exception 'حي الوادي / حي نجد were not admitted to الجبيلة';
  end if;
end $chk$;
