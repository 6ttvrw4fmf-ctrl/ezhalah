-- THE COUNT PILL NAMES THE DISTRICT (owner 2026-11-05: «you see how it says هذه المنطقة — include the name of the
-- district»). Which district (and which city) most listings inside a map view sit in, with each one's share, so the
-- app can say «7 إعلانات في حي الشراع» only when most of the view really is that district (src/lib/mapPins.ts
-- viewPlaceName, PLACE_SHARE). The box is compared as numeric so idx_slar_pin serves it (measured 2.9 ms for a
-- street-level view in Jeddah). At most 5,000 rows are read: the app asks only at city zoom and closer.
create or replace function public.map_view_place_ar(p_s double precision, p_w double precision, p_n double precision, p_e double precision)
returns table (district text, city text, district_share numeric, city_share numeric)
language sql stable security definer
set search_path = public
as $$
  with k as (
    select nullif(btrim(s.district_ar), '') d, nullif(btrim(s.city_ar), '') c
    from public.search_listings_ar s
    where s.latitude between p_s::numeric and p_n::numeric and s.longitude between p_w::numeric and p_e::numeric
    limit 5000
  ), t as (select count(*) n from k),
  dd as (select d, count(*) x from k where d is not null group by d order by 2 desc, 1 limit 1),
  cc as (select c, count(*) x from k where c is not null group by c order by 2 desc, 1 limit 1)
  select dd.d, cc.c, round(coalesce(dd.x, 0)::numeric / nullif(t.n, 0), 3), round(coalesce(cc.x, 0)::numeric / nullif(t.n, 0), 3)
  from t left join dd on true left join cc on true
  where t.n > 0;
$$;
revoke all on function public.map_view_place_ar(double precision, double precision, double precision, double precision) from public;
grant execute on function public.map_view_place_ar(double precision, double precision, double precision, double precision) to anon, authenticated;
