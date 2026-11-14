-- Unknown named districts (new-listings rule G, owner 2026-10-17; admission rule of 20261011133138 / 20261018035154).
-- «حي الروابي» in النعيرية (city 115, region 5): unknown_named_districts_checked(3) verdict 'new' (no twin) on 2026-11-14,
-- named by 3 distinct active abaad ads (26270345, 27534339, 17060133) with 3 distinct REGA licences
-- (7201217522, 7201152882, 7201160777), titles «ارض-النعيرية-حي الروابي», pins in one tight cluster
-- (27.469-27.475 N, 48.543-48.550 E). Not a town in loc_catalog_city, not a plan, street, direction or number,
-- and not a spelling of any of النعيرية's 10 catalogued districts. Same «حي X» form as the earlier admissions.
-- No listing row is written: the hourly district recovery and sync re-resolve through the sanctioned resolver.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select 115, v.d, public.norm_district_tok(v.d)
from (values ('حي الروابي')) as v(d)
where not exists (select 1 from public.loc_catalog_district
                   where city_id = 115 and district_norm = public.norm_district_tok(v.d));

do $chk$
begin
  if (select count(*) from public.loc_catalog_district
       where city_id = 115 and district_ar = 'حي الروابي' and retired_at is null) <> 1 then
    raise exception 'حي الروابي was not admitted to النعيرية';
  end if;
end $chk$;
