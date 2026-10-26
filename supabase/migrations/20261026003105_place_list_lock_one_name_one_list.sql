-- ONE NAME, ONE LIST (owner 2026-10-25: «a district must never ever leak into the city list, same with the other»).
-- Measured that day: 40 districts registered as cities («الثقبة», a district of الخبر 4.5 km away), 12 city names twice
-- within 40 km («بيش» ×2, 100 m apart), 40 towns registered as districts («المبرز» as a district of الهفوف) and 13 districts
-- named exactly like their own city («حي الدرعية» in الدرعية). The owner's rule for what a name is: a place with districts
-- under it is a CITY; a place without is a DISTRICT of the big city next to it.
--   1) loc_city_center: where each city's homes are (median pin), refreshed by the alarm at most once a day;
--   2) the city list refuses a new or renamed name that is already a city within 40 km (or, when no distance is known, in
--      the same region), or that is a district of a city within 40 km / in the same region; cities are never deleted
--      (a duplicate is MERGED by the owner, never dropped); the owner exception names the city: ezhalah.city_guard_ok;
--   3) the district list also refuses a name that is its own city, or a city within 40 km / in the region that has its own
--      districts (the owner exception ezhalah.district_guard_ok still names the district);
--   4) mon_detect_place_list_leaks() (P2, rostered) lists the existing leaks with counts and examples until they are
--      cleaned, and mon_detect_district_guards_missing() now watches the city trigger too.
-- Existing leaks are NOT deleted here: never delete; the owner decides each merge from the alarm's list.

create table if not exists public.loc_city_center (
  city_id      integer primary key references public.loc_catalog_city (city_id),
  lat          double precision not null,
  lng          double precision not null,
  ads          integer not null,
  refreshed_at timestamptz not null default now()
);
alter table public.loc_city_center enable row level security;
revoke all on table public.loc_city_center from public, anon, authenticated;

create or replace function public.refresh_loc_city_center()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare n integer;
begin
  insert into public.loc_city_center (city_id, lat, lng, ads, refreshed_at)
  select s.city_id, percentile_cont(0.5) within group (order by s.latitude), percentile_cont(0.5) within group (order by s.longitude), count(*), now()
    from public.search_listings_ar s
   where s.city_id is not null and s.latitude between 16 and 33 and s.longitude between 34 and 56
     and exists (select 1 from public.loc_catalog_city c where c.city_id = s.city_id)
   group by s.city_id
  on conflict (city_id) do update set lat = excluded.lat, lng = excluded.lng, ads = excluded.ads, refreshed_at = now();
  get diagnostics n = row_count;
  return n;
end $function$;
select public.refresh_loc_city_center();

create or replace function public.place_km(a integer, b integer)
returns numeric
language sql stable
as $function$
  select round((111.32 * sqrt(power(x.lat - y.lat, 2) + power((x.lng - y.lng) * cos(radians(x.lat)), 2)))::numeric, 1)
    from public.loc_city_center x, public.loc_city_center y where x.city_id = a and y.city_id = b
$function$;

-- true when two EXISTING cities are "the same area": under 40 km when both centers are known, else the same region
-- (the city guard reads the NEW row's region itself: a new row is not in the table yet)
create or replace function public.place_same_area(a integer, b integer)
returns boolean
language sql stable
as $function$
  select coalesce(public.place_km(a, b) < 40,
                  (select x.region_id = y.region_id from public.loc_catalog_city x, public.loc_catalog_city y where x.city_id = a and y.city_id = b))
$function$;

create or replace function public.trg_city_list_guard()
returns trigger
language plpgsql set search_path to 'public'
as $function$
declare k text; v_ok text := nullif(current_setting('ezhalah.city_guard_ok', true), ''); v_hit text;
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'city list guard: cities are never deleted — a duplicate is merged by the owner (owner 2026-10-25)';
  end if;
  k := public.district_key_letters(new.city_ar);
  if k = '' then raise exception 'city list guard: empty city name'; end if;
  new.city_norm := coalesce(new.city_norm, public.normalize_ar(new.city_ar));
  if v_ok is not null and public.district_key_letters(v_ok) = k then return new; end if;
  select c.city_ar || ' (city ' || c.city_id || ')' into v_hit from public.loc_catalog_city c
   where c.city_id <> new.city_id and public.district_key_letters(c.city_ar) = k
     and coalesce(public.place_km(c.city_id, new.city_id) < 40, c.region_id = new.region_id)
   limit 1;
  if v_hit is not null then
    raise exception 'city list guard: «%» is already the city % in the same area — one city, one row', new.city_ar, v_hit;
  end if;
  select d.district_ar || ' of ' || c.city_ar into v_hit from public.loc_catalog_district d join public.loc_catalog_city c on c.city_id = d.city_id
   where d.city_id <> new.city_id and public.district_key_letters(d.district_ar) = k
     and coalesce(public.place_km(d.city_id, new.city_id) < 40, c.region_id = new.region_id)
   limit 1;
  if v_hit is not null then
    raise exception 'city list guard: «%» is the district % — a district is not a city; the owner names a real town in ezhalah.city_guard_ok', new.city_ar, v_hit;
  end if;
  return new;
end $function$;

drop trigger if exists trg_zz_city_list_guard on public.loc_catalog_city;
create trigger trg_zz_city_list_guard
  before insert or update of city_ar, region_id or delete on public.loc_catalog_city
  for each row execute function public.trg_city_list_guard();
drop trigger if exists trg_zz_city_list_no_truncate on public.loc_catalog_city;
create trigger trg_zz_city_list_no_truncate
  before truncate on public.loc_catalog_city
  for each statement execute function public.trg_city_list_guard();

create or replace function public.trg_district_list_guard()
returns trigger
language plpgsql set search_path to 'public'
as $function$
declare v_norm text; v_twin record; v_strong record; v_city text; v_ok text := nullif(current_setting('ezhalah.district_guard_ok', true), '');
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'district list guard: districts are never deleted (owner 2026-10-25)';
  end if;
  v_norm := public.norm_district_tok(new.district_ar);
  if v_norm is null or v_norm = '' then
    raise exception 'district list guard: empty district name';
  end if;
  new.district_norm := coalesce(new.district_norm, v_norm);
  if v_ok is not null and public.norm_district_tok(v_ok) = v_norm then
    return new;
  end if;
  if char_length(v_norm) < 2 or new.district_ar ~ '[0-9٠-٩]'
     or v_norm ~ '(^|\s)(مخطط|مخططات|قاعده|شارع|طريق|قري)(\s|$)' then
    raise exception 'district list guard: «%» is not a district name (a number, plan, base, street, road, villages or one letter)', new.district_ar;
  end if;
  select * into v_twin from public.district_twin_check(new.city_id, new.district_ar) limit 1;
  if v_twin.verdict = 'twin' and not (tg_op = 'UPDATE' and v_twin.twin_ar is not distinct from old.district_ar) then
    raise exception 'district list guard: «%» is a spelling twin of «%» on the list for city % — use that name', new.district_ar, v_twin.twin_ar, new.city_id;
  end if;
  select * into v_strong from public.district_twin_strong(new.city_id, new.district_ar, case when tg_op = 'UPDATE' then old.district_id end) limit 1;
  if v_strong.twin_ar is not null then
    raise exception 'district list guard: «%» is the same district as «%» on the list for city % (%) — use that name, or the owner names it in ezhalah.district_guard_ok', new.district_ar, v_strong.twin_ar, new.city_id, v_strong.how;
  end if;
  -- one name, one list (owner 2026-10-25): a city is not a district
  if public.district_key_letters(new.district_ar) = (select public.district_key_letters(c.city_ar) from public.loc_catalog_city c where c.city_id = new.city_id) then
    raise exception 'district list guard: «%» is the name of its own city — a city is not a district', new.district_ar;
  end if;
  select c.city_ar || ' (city ' || c.city_id || ')' into v_city from public.loc_catalog_city c
   where c.city_id <> new.city_id and public.district_key_letters(c.city_ar) = public.district_key_letters(new.district_ar)
     and exists (select 1 from public.loc_catalog_district d where d.city_id = c.city_id)
     and public.place_same_area(c.city_id, new.city_id)
   limit 1;
  if v_city is not null then
    raise exception 'district list guard: «%» is the city % (it has its own districts) — a city is not a district; the owner names a real district in ezhalah.district_guard_ok', new.district_ar, v_city;
  end if;
  return new;
end $function$;

create or replace function public.mon_detect_district_guards_missing()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_missing text[]; v_open boolean; r int := 0;
begin
  select array_agg(w) into v_missing
    from unnest(array['trg_zz_district_list_guard', 'trg_zz_district_list_no_truncate', 'trg_pin_district_on_list', 'trg_zz_city_list_guard', 'trg_zz_city_list_no_truncate']) w
   where not exists (select 1 from pg_trigger t
                      where t.tgname = w and not t.tgisinternal and t.tgenabled <> 'D'
                        and t.tgrelid in ('public.loc_catalog_district'::regclass, 'public.listing_pin_district'::regclass, 'public.loc_catalog_city'::regclass));
  v_open := exists (select 1 from public.alert_event where dedup_key = 'district_guards_missing' and resolved_at is null);
  if v_missing is null then
    if v_open then perform public.mon_resolve('district_guards_missing', 'location'); end if;
  elsif not v_open then
    r := public.mon_raise('P1', 'district_guards_missing', 'location', 'district_guards_missing',
      jsonb_build_object('missing', to_jsonb(v_missing),
        'why', 'A district or city guard trigger is gone or disabled: a list could lose a row, gain a junk name, a spelling twin, or a name that belongs in the other list (owner 2026-10-25).',
        'action', 'Re-create the trigger from migrations district_guards_owner_2026_10_25 / place_list_lock; find which change dropped or disabled it.'));
  end if;
  return r;
end $function$;

create or replace function public.mon_detect_place_list_leaks()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare r int := 0; v_dup bigint; v_dic bigint; v_cid bigint; v_open boolean; ex jsonb;
begin
  if (select coalesce(max(refreshed_at), 'epoch') from public.loc_city_center) < now() - interval '1 day' then perform public.refresh_loc_city_center(); end if;
  create temp table _ck on commit drop as select city_id, city_ar, region_id, public.district_key_letters(city_ar) k from public.loc_catalog_city;
  create temp table _leaks on commit drop as
    select 'duplicate city'::text kind, a.city_ar name, a.city_id id, b.city_ar other, public.place_km(a.city_id, b.city_id) km
      from _ck a join _ck b on b.city_id > a.city_id and a.k = b.k and a.k <> '' and public.place_same_area(a.city_id, b.city_id)
    union all
    select 'district registered as a city', a.city_ar, a.city_id, d.district_ar || ' of ' || o.city_ar, public.place_km(a.city_id, o.city_id)
      from _ck a join public.loc_catalog_district d on public.district_key_letters(d.district_ar) = a.k and a.k <> '' join _ck o on o.city_id = d.city_id and o.city_id <> a.city_id
     where not exists (select 1 from public.loc_catalog_district x where x.city_id = a.city_id) and public.place_same_area(a.city_id, o.city_id)
    union all
    select 'city registered as a district', d.district_ar, d.district_id, 'own city ' || c.city_ar, 0
      from public.loc_catalog_district d join _ck c on c.city_id = d.city_id where public.district_key_letters(d.district_ar) = c.k
    union all
    select 'city registered as a district', d.district_ar, d.district_id, 'city ' || o.city_ar || ' (has districts)', public.place_km(d.city_id, o.city_id)
      from public.loc_catalog_district d join _ck c on c.city_id = d.city_id join _ck o on o.city_id <> c.city_id and o.k = public.district_key_letters(d.district_ar) and o.k <> ''
     where exists (select 1 from public.loc_catalog_district x where x.city_id = o.city_id) and public.place_same_area(c.city_id, o.city_id);
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
        'why', 'One name, one list (owner 2026-10-25): a place with districts under it is a city, otherwise a district of the city next to it. These rows sit in the wrong list or twice. New ones are refused by the guards; existing ones wait for the owner (never deleted).',
        'action', 'Owner decides each: merge a duplicate city (remap its listings, then retire the row), move a district to the right list, or name a real exception in ezhalah.city_guard_ok / ezhalah.district_guard_ok.'));
  end if;
  return r;
end $function$;

do $roster$
declare d text; anchor text := '''mon_detect_city_bridge_poisoned'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_place_list_leaks''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_place_list_leaks'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_place_list_leaks''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF, every write inside a rolled-back sub-transaction; nothing stays.
do $proof$
declare caught boolean; msg text; r_riyadh int := (select region_id from public.loc_catalog_city where city_id = 3);
  n_city bigint := (select count(*) from public.loc_catalog_city); n_dist bigint := (select count(*) from public.loc_catalog_district);
begin
  if (select count(*) from public.loc_city_center) < 300 then raise exception 'PROOF: city centers not filled'; end if;
  if public.place_km(3, 664) is null or public.place_km(3, 664) > 40 then raise exception 'PROOF: الرياض–الدرعية distance wrong (%)', public.place_km(3, 664); end if;
  -- city list: a district of الرياض cannot become a city of the same region
  caught := false;
  begin insert into public.loc_catalog_city (city_id, region_id, city_ar, city_norm) values (-1, r_riyadh, 'الملقا', 'الملقا');
  exception when others then caught := sqlerrm like 'city list guard: «الملقا» is the district%'; msg := sqlerrm; end;
  if not caught then raise exception 'PROOF: a district became a city (%)', msg; end if;
  -- city list: a second الرياض in the same region is refused
  caught := false;
  begin insert into public.loc_catalog_city (city_id, region_id, city_ar, city_norm) values (-1, r_riyadh, 'الرياض', 'الرياض');
  exception when others then caught := sqlerrm like 'city list guard: «الرياض» is already the city%'; msg := sqlerrm; end;
  if not caught then raise exception 'PROOF: a duplicate city was accepted (%)', msg; end if;
  -- city list: never deleted
  caught := false;
  begin delete from public.loc_catalog_city where city_id = (select max(city_id) from public.loc_catalog_city);
  exception when others then caught := sqlerrm like 'city list guard: cities are never deleted%'; end;
  if not caught then raise exception 'PROOF: a city delete was not refused'; end if;
  -- city list: the owner can name a real town that happens to share a district name
  begin
    perform set_config('ezhalah.city_guard_ok', 'الملقا', true);
    insert into public.loc_catalog_city (city_id, region_id, city_ar, city_norm) values (-1, r_riyadh, 'الملقا', 'الملقا');
    raise exception 'ROLLBACK_REVERT';
  exception when others then if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if; end;
  -- district list: a city is not a district
  caught := false;
  begin insert into public.loc_catalog_district (city_id, district_ar) values (3, 'الرياض');
  exception when others then caught := sqlerrm like 'district list guard: «الرياض» is the name of its own city%'; msg := sqlerrm; end;
  if not caught then raise exception 'PROOF: own city name became a district (%)', msg; end if;
  caught := false;
  begin insert into public.loc_catalog_district (city_id, district_ar) values (3, 'الدرعية');
  exception when others then caught := sqlerrm like 'district list guard: «الدرعية» is the city الدرعية%'; msg := sqlerrm; end;
  if not caught then raise exception 'PROOF: a nearby city with districts became a district (%)', msg; end if;
  -- a clean district still goes in (rolled back)
  begin
    insert into public.loc_catalog_district (city_id, district_ar) values (3, 'حي اختبار القفل الجديد تماما');
    raise exception 'ROLLBACK_REVERT';
  exception when others then if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if; end;
  if (select count(*) from public.loc_catalog_city) <> n_city or (select count(*) from public.loc_catalog_district) <> n_dist then raise exception 'PROOF: a list changed'; end if;
  if public.mon_detect_district_guards_missing() <> 0 then raise exception 'PROOF: guards read as missing'; end if;
  perform public.mon_detect_place_list_leaks();
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o in ('mon_detect_place_list_leaks')) <> 0 then raise exception 'PROOF: the leak detector reads as orphaned'; end if;
  raise notice 'PROOF OK: a district cannot become a city, a city cannot become a district, no duplicate city, no deletes; owner exceptions work; leak alarm rostered';
end $proof$;
