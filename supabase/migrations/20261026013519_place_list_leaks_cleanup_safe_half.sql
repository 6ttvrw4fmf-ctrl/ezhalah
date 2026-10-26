-- CLEAN THE OLD LEAKS, THE SAFE HALF (owner 2026-10-26: «do whatever you find good, finish it quick»). Nothing is deleted:
-- both lists get retired_at / retired_why, and a retired row is ignored by the leak alarm and by the display rule.
--   G1  13 districts named like their own city («حي الدرعية» in الدرعية, «حي ثول» in ثول): retired; a served district whose
--       letters equal its own city's name now shows CITY ONLY (loc_display_district_ar returns null) — same place twice.
--   G2  11 real cities sitting in the district list («المبرز» under الهفوف, 11 km; «بلجرشي» under الباحة): retired; a served
--       district whose letters equal a nearby city that has its own districts shows CITY ONLY until its homes are remapped.
--   G3  29 districts sitting in the city list («الثقبة» as a city, a district of الخبر): the city rows are retired.
--   G4  12 cities that exist twice within 40 km («بيش» ×2, 100 m): the row with fewer homes is retired.
-- The OTHER half — moving the homes of G2/G3/G4 to the right city — touches the location pipeline and is handed to the
-- New Listings Engineer with the exact ids (ops_engineer_backlog); it is NOT done here.

alter table public.loc_catalog_district add column if not exists retired_at timestamptz, add column if not exists retired_why text;
alter table public.loc_catalog_city add column if not exists retired_at timestamptz, add column if not exists retired_why text;
create index if not exists loc_catalog_city_k_idx on public.loc_catalog_city (public.district_key_letters(city_ar));

-- G1: a district named like its own city
update public.loc_catalog_district d set retired_at = now(), retired_why = 'own city name (owner 2026-10-26: a town is not its own district)'
  from public.loc_catalog_city c
 where c.city_id = d.city_id and d.retired_at is null and public.district_key_letters(d.district_ar) = public.district_key_letters(c.city_ar);

-- G2: a nearby city (that has districts) sitting in the district list
update public.loc_catalog_district d set retired_at = now(), retired_why = 'is the city ' || o.city_ar || ' (city ' || o.city_id || ', ' || public.place_km(d.city_id, o.city_id) || ' km) — homes to be remapped by the engineer'
  from public.loc_catalog_city c, public.loc_catalog_city o
 where c.city_id = d.city_id and o.city_id <> c.city_id and d.retired_at is null
   and public.district_key_letters(o.city_ar) = public.district_key_letters(d.district_ar)
   and exists (select 1 from public.loc_catalog_district x where x.city_id = o.city_id and x.district_id <> d.district_id)
   and public.place_km(d.city_id, o.city_id) < 40;

-- G4: the smaller of two same-name cities within 40 km
update public.loc_catalog_city a set retired_at = now(), retired_why = 'duplicate of city ' || b.city_id || ' (' || b.city_ar || ', ' || public.place_km(a.city_id, b.city_id) || ' km) — homes to be remapped by the engineer'
  from public.loc_catalog_city b
 where b.city_id <> a.city_id and a.retired_at is null and b.retired_at is null
   and public.district_key_letters(a.city_ar) = public.district_key_letters(b.city_ar) and public.district_key_letters(a.city_ar) <> ''
   and public.place_km(a.city_id, b.city_id) < 40
   and (coalesce((select ads from public.loc_city_center where city_id = a.city_id), 0), a.city_id)
     < (coalesce((select ads from public.loc_city_center where city_id = b.city_id), 0), b.city_id);

-- G3: a district sitting in the city list (a city row with no districts, named like a district of a city within 40 km)
update public.loc_catalog_city a set retired_at = now(), retired_why = 'is the district ' || d.district_ar || ' of ' || o.city_ar || ' (city ' || o.city_id || ', ' || public.place_km(a.city_id, o.city_id) || ' km) — homes to be remapped by the engineer'
  from public.loc_catalog_district d join public.loc_catalog_city o on o.city_id = d.city_id
 where a.retired_at is null and o.city_id <> a.city_id and d.retired_at is null
   and public.district_key_letters(d.district_ar) = public.district_key_letters(a.city_ar) and public.district_key_letters(a.city_ar) <> ''
   and not exists (select 1 from public.loc_catalog_district x where x.city_id = a.city_id)
   and public.place_km(a.city_id, o.city_id) < 40;

-- district_key_letters(): same letters, same marker, same tail as v2 (the two expression indexes stay valid), but plpgsql with a
-- cached plan: the SQL+CTE version was planned on every call and made the display rule cost 1.6 ms per home.
create or replace function public.district_key_letters(p text)
returns text
language plpgsql immutable
as $function$
declare s text; tl text := ''; base text;
begin
  s := regexp_replace(regexp_replace(public.normalize_ar(coalesce(p, '')), '^(حي\s+)+', ''), '^ال', '');
  if s ~ '(^|\s)[ء-ي]$' and s ~ '\s' then tl := right(s, 1); s := left(s, length(s) - 1); end if;
  base := regexp_replace(s, '[^ء-ي]', '', 'g');
  if base = '' then return ''; end if;
  return public.district_key_finish(base) || case when tl <> '' then '|' || tl else '' end;
end $function$;

-- the display rule: a served district that is its own city's name, or a nearby city with districts, shows city only.
-- plpgsql with early exits and cached plans: the first SQL-function version cost 3 ms per home (63 s for 20,000).
create or replace function public.district_place_hidden(p_city_id integer, p_shown text)
returns boolean
language plpgsql stable
as $function$
declare sk text; ck text;
begin
  if p_shown is null then return false; end if;
  sk := public.district_key_letters(p_shown);
  if sk = '' then return false; end if;
  select public.district_key_letters(c.city_ar) into ck from public.loc_catalog_city c where c.city_id = p_city_id;
  if sk = ck then return true; end if;
  return exists (select 1 from public.loc_catalog_city o
                  where public.district_key_letters(o.city_ar) = sk and o.city_id <> p_city_id and o.retired_at is null
                    and exists (select 1 from public.loc_catalog_district x where x.city_id = o.city_id and x.retired_at is null)
                    and public.place_km(o.city_id, p_city_id) < 40);
end $function$;

CREATE OR REPLACE FUNCTION public.loc_display_district_ar(p_city_id integer, p_raw text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case when p_raw is null then null else (
    select case when public.district_place_hidden(p_city_id, shown) then null else shown end
      from (select coalesce(
                     (select k.display_ar from public.loc_display_district_canon k
                       where k.city_id = p_city_id and k.district_norm = t.key),
                     (select c.district_ar from public.loc_catalog_district c
                       where t.key <> t.own and c.city_id = p_city_id and c.district_norm = t.key limit 1),
                     p_raw) as shown
              from (select norm_district_tok(p_raw) as own,
                           coalesce(
                             (select a.to_norm from public.loc_district_alias a
                               where a.city_id = p_city_id and a.from_norm = norm_district_tok(p_raw)),
                             (select b.district_norm from public.loc_catalog_district b
                               where norm_district_tok(p_raw) ~ '\s+(ال)?جديد[ه]?$'
                                 and b.city_id = p_city_id
                                 and b.district_norm = regexp_replace(norm_district_tok(p_raw), '\s+(ال)?جديد[ه]?$', '')
                                 and not exists (select 1 from public.loc_catalog_district f
                                                  where f.city_id = p_city_id and f.district_norm = norm_district_tok(p_raw))
                               limit 1),
                             public.district_copy_of(p_city_id, p_raw),
                             norm_district_tok(p_raw)) as key) t) s)
  end $function$;

-- the leak alarm ignores retired rows
create or replace function public.mon_detect_place_list_leaks()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare r int := 0; v_dup bigint; v_dic bigint; v_cid bigint; v_open boolean; ex jsonb;
begin
  if (select coalesce(max(refreshed_at), 'epoch') from public.loc_city_center) < now() - interval '1 day' then perform public.refresh_loc_city_center(); end if;
  create temp table _ck on commit drop as select c.city_id, c.city_ar, c.region_id, public.district_key_letters(c.city_ar) k from public.loc_catalog_city c where c.retired_at is null;
  create temp table _ld on commit drop as select d.district_id, d.city_id, d.district_ar, public.district_key_letters(d.district_ar) k from public.loc_catalog_district d where d.retired_at is null;
  create temp table _leaks on commit drop as
    select 'duplicate city'::text kind, a.city_ar name, a.city_id id, b.city_ar other, public.place_km(a.city_id, b.city_id) km
      from _ck a join _ck b on b.city_id > a.city_id and a.k = b.k and a.k <> '' and public.place_km(a.city_id, b.city_id) < 40
    union all
    select 'district registered as a city', a.city_ar, a.city_id, d.district_ar || ' of ' || o.city_ar, public.place_km(a.city_id, o.city_id)
      from _ck a join _ld d on d.k = a.k and a.k <> '' join _ck o on o.city_id = d.city_id and o.city_id <> a.city_id
     where not exists (select 1 from _ld x where x.city_id = a.city_id) and public.place_km(a.city_id, o.city_id) < 40
    union all
    select 'city registered as a district', d.district_ar, d.district_id, 'own city ' || c.city_ar, 0
      from _ld d join _ck c on c.city_id = d.city_id where d.k = c.k
    union all
    select 'city registered as a district', d.district_ar, d.district_id, 'city ' || o.city_ar || ' (has districts)', public.place_km(d.city_id, o.city_id)
      from _ld d join _ck c on c.city_id = d.city_id join _ck o on o.city_id <> c.city_id and o.k = d.k and o.k <> ''
     where exists (select 1 from _ld x where x.city_id = o.city_id) and public.place_km(d.city_id, o.city_id) < 40;
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
        'why', 'One name, one list (owner 2026-10-25): a place with districts under it is a city, otherwise a district of the city next to it. These rows sit in the wrong list or twice (only places whose homes we can see; retired rows are ignored). New ones are refused by the guards.',
        'action', 'Owner decides each: merge a duplicate city (remap its listings, then retire the row), move a district to the right list, or name a real exception in ezhalah.city_guard_ok / ezhalah.district_guard_ok.'));
  end if;
  return r;
end $function$;

-- PROOF
do $proof$
declare t0 timestamptz; ms numeric; n1 int; n2 int; n3 int;
begin
  select count(*) into n1 from public.loc_catalog_district where retired_at is not null and retired_why like 'own city name%';
  select count(*) into n2 from public.loc_catalog_district where retired_at is not null and retired_why like 'is the city %';
  select count(*) into n3 from public.loc_catalog_city where retired_at is not null;
  if n1 < 10 or n2 < 8 or n3 < 30 then raise exception 'PROOF: retired counts too low (% own-name, % cities-in-district-list, % city rows)', n1, n2, n3; end if;
  if exists (select 1 from public.loc_catalog_city where retired_at is not null and city_id in (3, 18, 6, 13, 12, 14, 15, 31, 62, 80)) then raise exception 'PROOF: a big city was retired'; end if;
  if public.loc_display_district_ar(664, 'حي الدرعية') is not null then raise exception 'PROOF: own-city district still shown'; end if;
  if public.loc_display_district_ar(1879, 'حي ثول') is not null then raise exception 'PROOF: حي ثول still shown'; end if;
  if public.loc_display_district_ar(12, 'المبرز') is not null then raise exception 'PROOF: المبرز still shown as a district of الهفوف'; end if;
  if public.loc_display_district_ar(3, 'حي النرجس') <> 'حي النرجس' then raise exception 'PROOF: a plain district changed'; end if;
  if public.loc_display_district_ar(18, 'حي البوادي') <> 'حي البوادي' or public.loc_display_district_ar(18, 'البوادر') <> 'البوادر' then raise exception 'PROOF: جدة districts changed'; end if;
  if public.loc_display_district_ar(6, 'الهجلة الجديد') <> 'حي الهجلة' then raise exception 'PROOF: the «الجديد» rule broke'; end if;
  if public.loc_display_district_ar(3, 'المعيزيلة') <> 'حي المعيزلة' then raise exception 'PROOF: an alias broke'; end if;
  if public.loc_display_district_ar(3, 'حي الرياض') is not null then raise exception 'PROOF: «حي الرياض» in الرياض still shown'; end if;
  if public.loc_display_district_ar(3677, 'حي الرياض') is null then raise exception 'PROOF: «حي الرياض» in الاحساء (a real district, الرياض 300 km away) was hidden'; end if;
  if public.district_key_letters('حي الجابرية أ') <> 'جابري#|ا' or public.district_key_letters('الزهراء') <> 'زهراء' or public.district_key_letters('حي الملقاه') <> 'ملق#' or public.district_key_letters('حي الربوة - بقيق') <> 'ربوهبقيق' then raise exception 'PROOF: the letters key changed (indexes would be stale)'; end if;
  t0 := clock_timestamp();
  perform public.loc_display_district_ar(s.city_id, s.district_ar) from (select city_id, district_ar from public.search_listings_ar where district_ar is not null and city_id is not null limit 20000) s;
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  if ms > 20000 then raise exception 'PROOF: 20,000 display calls took % ms', round(ms); end if;
  perform public.mon_detect_place_list_leaks();
  if exists (select 1 from public.alert_event where dedup_key = 'place_list_leaks' and resolved_at is null) then raise exception 'PROOF: the leak alarm is still open after retiring the rows'; end if;
  raise notice 'PROOF OK: % own-name districts, % city-named districts and % city rows retired; own-city / nearby-city districts show city only; leak alarm resolved; 20,000 display calls in % ms', n1, n2, n3, round(ms);
end $proof$;
