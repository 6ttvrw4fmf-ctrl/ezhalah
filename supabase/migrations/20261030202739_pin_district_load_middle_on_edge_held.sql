-- Pin districts, the loader (owner main rule 2026-10-25; nightly from 2026-10-30).
-- One entry point for a batch of Apple answers: a home whose pin and all 4 spots 150 m around it name the SAME district
-- (verdict 'middle') is switched on; a home near an edge is loaded switched OFF and waits for Google. Every row must still
-- (1) name a district already on that city's list (trg_pin_district_on_list stores the list spelling), (2) sit in the city
-- Apple names, (3) be a served ad with no district, (4) not share its pin with 5+ ads (a site's default pin), (5) not
-- already have a pin row. Nothing here overwrites an earlier row. Service role only: the public keys cannot call it.
create or replace function public.pin_district_load(p_rows jsonb, p_run_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_on int; v_edge int; v_total int; v_unlisted int; v_city int; v_silent int; v_already int; v_not_blank int; v_shared int;
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
   where list_name is not null and city_ok and blank and not already and not shared
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
         count(*) filter (where shared)
    into v_silent, v_unlisted, v_city, v_already, v_not_blank, v_shared
    from _pin_in;
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_top
    from (select cid, name, count(*) n from _pin_in
           where name is not null and list_name is null and city_ok
           group by 1, 2 order by 3 desc limit 25) t;

  return jsonb_build_object('run_id', p_run_id, 'rows', v_total, 'switched_on', v_on, 'held_edge', v_edge,
                            'apple_silent', v_silent, 'name_not_on_list', v_unlisted, 'other_city', v_city,
                            'already_had_pin_row', v_already, 'not_a_blank_served_ad', v_not_blank, 'shared_pin', v_shared,
                            'top_names_not_on_list', v_top);
end
$function$;

revoke all on function public.pin_district_load(jsonb, text) from public, anon, authenticated;

comment on function public.pin_district_load(jsonb, text) is
  'Loads a batch of Apple pin answers into listing_pin_district: middle homes switched on, edge homes held, only list districts in the same city for served blank ads (owner rule 2026-10-25). Service role only.';

do $proof$
declare r jsonb;
begin
  r := public.pin_district_load('[{"st":"aqar_residential_listings","lid":1,"cid":3,"name":"حي لا وجود له","locality":"الرياض","verdict":"middle","lat":24.7,"lng":46.7}]'::jsonb, 'apple-ring-2000-01-01');
  if (r->>'switched_on')::int <> 0 or (r->>'held_edge')::int <> 0 then raise exception 'PROOF: a row with a name not on the list was loaded: %', r; end if;
  if (r->>'name_not_on_list')::int <> 1 then raise exception 'PROOF: the unlisted name was not counted: %', r; end if;
  begin
    perform public.pin_district_load('[]'::jsonb, 'anything');
    raise exception 'PROOF: a free-form run_id was accepted';
  exception when raise_exception then
    if sqlerrm like 'PROOF:%' then raise; end if;
  end;
  raise notice 'PROOF OK: %', r;
end $proof$;
