-- place_list_leaks alarm: count only leaks we can SEE (2026-10-25, 30 minutes after the lock). With the same-region fallback
-- the first run reported 307 duplicate cities and 807 districts-as-cities, mostly villages with no listings that merely
-- share a common name with a district somewhere in their region («الروضة»). A village with no homes is not in search and
-- cannot leak. The alarm now compares only cities whose homes' center is known (both under 40 km): 12 duplicate cities,
-- 40 districts registered as cities, 53 cities registered as districts as measured today. The GUARDS keep the strict
-- fallback: a NEW row has no homes yet, and «never ever» means it is refused unless the owner names it.
create or replace function public.mon_detect_place_list_leaks()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare r int := 0; v_dup bigint; v_dic bigint; v_cid bigint; v_open boolean; ex jsonb;
begin
  if (select coalesce(max(refreshed_at), 'epoch') from public.loc_city_center) < now() - interval '1 day' then perform public.refresh_loc_city_center(); end if;
  create temp table _ck on commit drop as select c.city_id, c.city_ar, c.region_id, public.district_key_letters(c.city_ar) k from public.loc_catalog_city c;
  create temp table _leaks on commit drop as
    select 'duplicate city'::text kind, a.city_ar name, a.city_id id, b.city_ar other, public.place_km(a.city_id, b.city_id) km
      from _ck a join _ck b on b.city_id > a.city_id and a.k = b.k and a.k <> '' and public.place_km(a.city_id, b.city_id) < 40
    union all
    select 'district registered as a city', a.city_ar, a.city_id, d.district_ar || ' of ' || o.city_ar, public.place_km(a.city_id, o.city_id)
      from _ck a join public.loc_catalog_district d on public.district_key_letters(d.district_ar) = a.k and a.k <> '' join _ck o on o.city_id = d.city_id and o.city_id <> a.city_id
     where not exists (select 1 from public.loc_catalog_district x where x.city_id = a.city_id) and public.place_km(a.city_id, o.city_id) < 40
    union all
    select 'city registered as a district', d.district_ar, d.district_id, 'own city ' || c.city_ar, 0
      from public.loc_catalog_district d join _ck c on c.city_id = d.city_id where public.district_key_letters(d.district_ar) = c.k
    union all
    select 'city registered as a district', d.district_ar, d.district_id, 'city ' || o.city_ar || ' (has districts)', public.place_km(d.city_id, o.city_id)
      from public.loc_catalog_district d join _ck c on c.city_id = d.city_id join _ck o on o.city_id <> c.city_id and o.k = public.district_key_letters(d.district_ar) and o.k <> ''
     where exists (select 1 from public.loc_catalog_district x where x.city_id = o.city_id) and public.place_km(d.city_id, o.city_id) < 40;
  select count(*) filter (where kind = 'duplicate city'), count(*) filter (where kind = 'district registered as a city'), count(*) filter (where kind = 'city registered as a district')
    into v_dup, v_dic, v_cid from _leaks;
  v_open := exists (select 1 from public.alert_event where dedup_key = 'place_list_leaks' and resolved_at is null);
  if v_dup + v_dic + v_cid = 0 then
    if v_open then perform public.mon_resolve('place_list_leaks', 'location'); end if;
  elsif not v_open then
    select jsonb_agg(jsonb_build_object('kind', kind, 'name', name, 'id', id, 'other', other, 'km', km)) into ex
      from (select * from _leaks order by kind, km nulls last limit 30) x;
    r := public.mon_raise('P2', 'place_list_leaks', 'location', 'place_list_leaks',
      jsonb_build_object('duplicate_cities', v_dup, 'districts_in_city_list', v_dic, 'cities_in_district_list', v_cid, 'examples', ex,
        'why', 'One name, one list (owner 2026-10-25): a place with districts under it is a city, otherwise a district of the city next to it. These rows sit in the wrong list or twice (only places whose homes we can see). New ones are refused by the guards; existing ones wait for the owner (never deleted).',
        'action', 'Owner decides each: merge a duplicate city (remap its listings, then retire the row), move a district to the right list, or name a real exception in ezhalah.city_guard_ok / ezhalah.district_guard_ok.'));
  end if;
  return r;
end $function$;

-- re-measure now: close the over-wide alert and raise the real one
do $proof$
declare d jsonb;
begin
  perform public.mon_resolve('place_list_leaks', 'location');
  perform public.mon_detect_place_list_leaks();
  select detail into d from public.alert_event where dedup_key = 'place_list_leaks' and resolved_at is null;
  if d is null then raise exception 'PROOF: the leak alarm did not re-raise (there are known leaks)'; end if;
  if (d->>'duplicate_cities')::int > 60 or (d->>'districts_in_city_list')::int > 120 then
    raise exception 'PROOF: the alarm still counts invisible villages (% dup, % dic)', d->>'duplicate_cities', d->>'districts_in_city_list';
  end if;
  raise notice 'PROOF OK: leaks counted only where homes are seen: % duplicate cities, % districts in the city list, % cities in the district list', d->>'duplicate_cities', d->>'districts_in_city_list', d->>'cities_in_district_list';
end $proof$;
