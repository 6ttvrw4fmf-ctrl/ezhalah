-- Unknown named districts (new-listings rule 6, owner 2026-10-24/25): «المنتزهات», «الندى» and «الوداد» in جدة (city 18).
-- unknown_named_districts_checked(3) verdict 'new' (no twin) for all three on 2026-11-10: muhaysini 5 / 22 / 23 active ads.
-- Each name carries ONE government (REGA) district code in the ads' own licence record — المنتزهات 4152, الندى 4162,
-- الوداد 4189 — with city «جدة», and the pins sit in three tight clusters (المنتزهات 21.48N 39.28-39.30E; الندى
-- 21.95-22.01N 39.18-39.20E; الوداد 21.93-21.95N 39.19-39.21E). None is a town in loc_catalog_city, a plan, a street, a
-- direction or a number. «حي المنتزة» (already catalogued) is a different district; the twin check says so.
-- Same admission rule and «حي X» form as the earlier admissions. No listing row is written: the hourly district recovery
-- and sync re-resolve through the sanctioned resolver.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select 18, v.d, public.norm_district_tok(v.d)
from (values ('حي المنتزهات'), ('حي الندى'), ('حي الوداد')) as v(d)
where not exists (select 1 from public.loc_catalog_district
                   where city_id = 18 and district_norm = public.norm_district_tok(v.d));

do $chk$
begin
  if (select count(*) from public.loc_catalog_district
       where city_id = 18 and district_ar in ('حي المنتزهات', 'حي الندى', 'حي الوداد') and retired_at is null) <> 3 then
    raise exception 'حي المنتزهات / حي الندى / حي الوداد were not admitted to جدة';
  end if;
end $chk$;