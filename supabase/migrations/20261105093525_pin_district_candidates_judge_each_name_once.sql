-- pin_district_candidates() judges each (city, site district name) PAIR once, not each ad (20261105085039 follow-up).
-- After 20261105093413 it still took 4.7 s against PostgREST's 8 s: ~560 own-town ads paid the ~5 ms display test one
-- by one although they carry ~40 distinct (city, name) pairs. Same filters, same order, same answer.
create or replace function public.pin_district_candidates(p_max integer default 600)
 returns table (source_table text, listing_id bigint, city_id integer, latitude double precision, longitude double precision)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with shared as (
    select round(s.latitude::numeric, 5) la, round(s.longitude::numeric, 5) lo
      from public.search_listings_ar s
     where s.production_ready and s.latitude is not null and s.longitude is not null
     group by 1, 2 having count(*) >= 5),
  cov as (select d.city_id, count(*) nd from public.loc_catalog_district d where d.retired_at is null group by 1),
  blank as (
    select s.source_table, s.listing_id, s.city_id, s.latitude, s.longitude, s.last_updated,
           nullif(btrim(v1.district_ar), '') as site_district, k.listing_id is null as never_asked
      from public.search_listings_ar s
      left join public.listing_pin_ask k on k.source_table = s.source_table and k.listing_id = s.listing_id
      left join public.listing_native_location_v1 v1 on v1.source_table = s.source_table and v1.listing_id = s.listing_id
     where s.production_ready and (s.district_ar is null or btrim(s.district_ar) = '')
       and s.latitude is not null and s.longitude is not null and s.city_id is not null
       and (k.listing_id is null or k.asked_at < now() - interval '14 days')
       and not exists (select 1 from public.listing_pin_district p where p.source_table = s.source_table and p.listing_id = s.listing_id)
       and not exists (select 1 from public.listing_title_district lt where lt.source_table = s.source_table and lt.listing_id = s.listing_id)),
  own_town as (
    select t.city_id, t.site_district, public.district_is_own_town(t.city_id, t.site_district) as ok
      from (select distinct b.city_id, b.site_district from blank b where b.site_district is not null) t)
  select b.source_table, b.listing_id, b.city_id, b.latitude::double precision, b.longitude::double precision
    from blank b
    left join own_town o on o.city_id = b.city_id and o.site_district = b.site_district
    left join cov on cov.city_id = b.city_id
   where (b.site_district is null or o.ok)
     and not exists (select 1 from shared x where x.la = round(b.latitude::numeric, 5) and x.lo = round(b.longitude::numeric, 5))
     and not exists (select 1 from public.listing_source_district_ar sd
                      where sd.source_table = b.source_table and sd.listing_id = b.listing_id
                        and not public.district_is_own_town(b.city_id, sd.source_district_ar))
   order by b.never_asked desc, (coalesce(cov.nd, 0) >= 10) desc, b.last_updated desc nulls last, b.source_table, b.listing_id
   limit greatest(coalesce(p_max, 600), 0)
$function$;

revoke all on function public.pin_district_candidates(integer) from public, anon, authenticated;

do $proof$
declare t0 timestamptz := clock_timestamp(); n int;
begin
  select count(*) into n from public.pin_district_candidates(1000);
  if clock_timestamp() - t0 > interval '3 seconds' then
    raise exception 'PROOF: pin_district_candidates still takes %', clock_timestamp() - t0;
  end if;
  if not exists (select 1 from public.pin_district_candidates(5000) c where c.source_table = 'aqar_residential_listings' and c.listing_id = 326911) then
    raise exception 'PROOF: the own-town ad aqar 326911 is no longer a candidate';
  end if;
  raise notice 'PROOF OK: % candidates in %', n, clock_timestamp() - t0;
end $proof$;
