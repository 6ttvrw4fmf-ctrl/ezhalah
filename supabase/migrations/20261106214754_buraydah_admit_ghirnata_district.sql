-- Unknown named district (rule G, new-listings engineer 2026-11-06): «غرناطة» in بريدة (city 11).
-- unknown_named_districts_checked(3) verdict 'new' (no twin), 5 sadiqeltajer arrivals; the served index files
-- 22 active ads in بريدة under «غرناطة» from four sites (dealapp 15, sadiqeltajer 5, aqarcity 1, vmksa 1);
-- the three independent sites' pins agree (26.22-26.27N, 43.91-43.93E). Not a town in loc_catalog_city, not a
-- plan / direction / number. Same admission rule and «حي X» form as 20261011133138 / 20261018035154.
-- No listing row is written: the hourly district recovery and sync re-resolve through the sanctioned resolver.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select 11, 'حي غرناطة', public.norm_district_tok('حي غرناطة')
where not exists (select 1 from public.loc_catalog_district
                   where city_id = 11 and district_norm = public.norm_district_tok('حي غرناطة'));

do $chk$
begin
  if not exists (select 1 from public.loc_catalog_district
                  where city_id = 11 and district_ar = 'حي غرناطة' and retired_at is null) then
    raise exception 'حي غرناطة was not admitted to بريدة';
  end if;
end $chk$;
