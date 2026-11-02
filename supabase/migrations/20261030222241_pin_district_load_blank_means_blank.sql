-- pin_district_load(): «blank» means what the pin arm means (2026-10-30, same day as the loader).
--
-- The first load counted an ad as blank when the SERVED index had no district. But an ad whose site names a district
-- that is not on our list is served without a district too, and the pin arm (refresh_district_recovery_table) rightly
-- refuses to overrule the site's own words (owner rule 1: the site's district always wins). Measured on run
-- apple-ring-2026-10-30: of 358 rows switched on, most carried a site-named district (e.g. aqar 326911 «حي الدرعية
-- الجديدة» while Apple said «العمارية») and could never serve. Those rows are not gap fills: they are deleted here, and
-- from now on the loader asks the arm's question — no native district, no source-stated district — before loading.
create or replace function public.pin_district_load(p_rows jsonb, p_run_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_on int; v_edge int; v_total int; v_unlisted int; v_city int; v_silent int; v_already int; v_not_blank int; v_shared int;
  v_site_named int;
  v_top jsonb;
begin
  if p_run_id is null or p_run_id !~ '^apple-(nightly|ring)-\d{4}-\d{2}-\d{2}$' then
    raise exception 'pin_district_load: run_id must be apple-nightly-YYYY-MM-DD or apple-ring-YYYY-MM-DD, got %', p_run_id;
  end if;

  create temp table _pin_shared on commit drop as
    select round(latitude::numeric, 5) la, round(longitude::numeric, 5) lo
      from public.search_listings_ar
     where production_ready and latitude is not null and longitude is not null
     group by 1, 2 having count(*) >= 5;

  create temp table _pin_in on commit drop as
    select r.st, r.lid, r.cid, r.name, r.locality, r.verdict, r.lat, r.lng,
           c.district_ar as list_name,
           (ci.city_id is not null and public.norm_district_tok(ci.city_ar) = public.norm_district_tok(coalesce(r.locality, ''))) as city_ok,
           exists (select 1 from public.search_listings_ar x
                    where x.source_table = r.st and x.listing_id = r.lid and x.city_id = r.cid and x.production_ready
                      and (x.district_ar is null or btrim(x.district_ar) = '')) as blank,
           -- the site itself names a district (in its own words, or a source-stated one): the pin never overrules it
           (exists (select 1 from public.listing_native_location_v2 v
                     where v.source_table = r.st and v.listing_id = r.lid and nullif(btrim(v.district_ar), '') is not null)
            or exists (select 1 from public.listing_source_district_ar sd
                        where sd.source_table = r.st and sd.listing_id = r.lid)) as site_named,
           exists (select 1 from public.listing_pin_district p where p.source_table = r.st and p.listing_id = r.lid) as already,
           exists (select 1 from _pin_shared s where s.la = round(r.lat::numeric, 5) and s.lo = round(r.lng::numeric, 5)) as shared
      from jsonb_to_recordset(p_rows) as r(st text, lid bigint, cid int, name text, locality text, verdict text, lat double precision, lng double precision)
      left join public.loc_catalog_city ci on ci.city_id = r.cid
      left join lateral (
        select c.district_ar
          from public.loc_catalog_district c
         where c.city_id = r.cid and r.name is not null
           and c.district_norm = public.norm_district_tok(public.loc_display_district_ar(r.cid, r.name))
           and c.district_ar !~ '[0-9٠-٩]'
           and public.norm_district_tok(c.district_ar) !~ '(^|\s)(مخطط|مخططات|قاعده|شارع|طريق|قري)(\s|$)'
         limit 1) c on true;

  insert into public.listing_pin_district (source_table, listing_id, city_id, district_ar, run_id, applied)
  select st, lid, cid, list_name, p_run_id, (verdict = 'middle')
    from _pin_in
   where list_name is not null and city_ok and blank and not site_named and not already and not shared
     and verdict in ('middle', 'edge')
  on conflict (source_table, listing_id) do nothing;

  select count(*) into v_total from _pin_in;
  select count(*) filter (where applied), count(*) filter (where not applied)
    into v_on, v_edge
    from public.listing_pin_district where run_id = p_run_id;
  select count(*) filter (where name is null),
         count(*) filter (where name is not null and list_name is null),
         count(*) filter (where name is not null and list_name is not null and not city_ok),
         count(*) filter (where already),
         count(*) filter (where not blank),
         count(*) filter (where shared),
         count(*) filter (where blank and site_named)
    into v_silent, v_unlisted, v_city, v_already, v_not_blank, v_shared, v_site_named
    from _pin_in;
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_top
    from (select cid, name, count(*) n from _pin_in
           where name is not null and list_name is null and city_ok and not site_named
           group by 1, 2 order by 3 desc limit 25) t;

  return jsonb_build_object('run_id', p_run_id, 'rows', v_total, 'switched_on', v_on, 'held_edge', v_edge,
                            'apple_silent', v_silent, 'name_not_on_list', v_unlisted, 'other_city', v_city,
                            'already_had_pin_row', v_already, 'not_a_blank_served_ad', v_not_blank, 'shared_pin', v_shared,
                            'site_names_its_own_district', v_site_named,
                            'top_names_not_on_list', v_top);
end
$function$;

revoke all on function public.pin_district_load(jsonb, text) from public, anon, authenticated;

-- Today's run: drop the rows the arm can never serve (the site names a district), so the counts tell the truth and a
-- future night can re-judge them if the site's words change.
do $clean$
declare removed int;
begin
  delete from public.listing_pin_district p
   where p.run_id = 'apple-ring-2026-10-30'
     and (exists (select 1 from public.listing_native_location_v2 v
                   where v.source_table = p.source_table and v.listing_id = p.listing_id and nullif(btrim(v.district_ar), '') is not null)
          or exists (select 1 from public.listing_source_district_ar sd
                      where sd.source_table = p.source_table and sd.listing_id = p.listing_id));
  get diagnostics removed = row_count;
  raise notice 'apple-ring-2026-10-30: % rows removed (the site names a district); % remain', removed,
    (select count(*) from public.listing_pin_district where run_id = 'apple-ring-2026-10-30');
end $clean$;

do $proof$
declare r jsonb;
begin
  -- aqar 326911 is served without a district but its site says «حي الدرعية الجديدة»: the loader must refuse it.
  r := public.pin_district_load('[{"st":"aqar_residential_listings","lid":326911,"cid":664,"name":"العمارية","locality":"الدرعية","verdict":"middle","lat":24.777895,"lng":46.405538}]'::jsonb, 'apple-ring-2000-01-02');
  if (r->>'switched_on')::int <> 0 then raise exception 'PROOF: a site-named ad was loaded: %', r; end if;
  if (r->>'site_names_its_own_district')::int <> 1 then raise exception 'PROOF: the site-named ad was not counted: %', r; end if;
  raise notice 'PROOF OK: %', r;
end $proof$;
