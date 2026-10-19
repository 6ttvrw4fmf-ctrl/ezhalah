-- Location names never carry irregular whitespace (owner 2026-10-19). The catalogue spelled three districts and three
-- cities with a doubled space («حي  السبهاني», «بدائع  الجرعاء» …); every card that resolved to them served the doubled
-- space (gathern ×3, ksaaqar, suwar). Three bridge rows (sanadak, aqarcity) and wasalt's own «مخطط وادي  الفرع» ×20 /
-- «عثمر   المخطط» ×4 reached the index the same way: 30 served districts and 25 served cities on 2026-10-19.
--   1) public.squash_ws(): trim, then one plain space for every whitespace run. Applied by ONE trigger function on every
--      write to the catalogue (loc_catalog_city.city_ar, loc_catalog_district.district_ar), the bridge
--      (listings_arabic_locations) and the index (search_listings_ar.city_ar / district_ar).
--   2) Repair: the 6 catalogue rows, the 3 bridge rows and the served rows, through the same trigger.
--   3) P2 detector mon_detect_location_whitespace_irregular(): any catalogue / bridge / served name that squash_ws()
--      would change. Rostered. Apply-time proof (rolled back): the trigger squashes a doubled space; with the trigger
--      dropped, the detector sees it.
set local lock_timeout = '5s';

create or replace function public.squash_ws(v text) returns text
language sql immutable parallel safe set search_path to 'public'
as $function$ select regexp_replace(regexp_replace(v, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g') $function$;

create or replace function public.trg_location_names_squash_ws() returns trigger
language plpgsql set search_path to 'public'
as $function$
begin
  if TG_TABLE_NAME = 'loc_catalog_city' then
    NEW.city_ar := public.squash_ws(NEW.city_ar);
  elsif TG_TABLE_NAME = 'loc_catalog_district' then
    NEW.district_ar := public.squash_ws(NEW.district_ar);
  else
    NEW.city_ar := public.squash_ws(NEW.city_ar);
    NEW.district_ar := public.squash_ws(NEW.district_ar);
  end if;
  return NEW;
end
$function$;

drop trigger if exists trg_squash_ws on public.loc_catalog_city;
create trigger trg_squash_ws before insert or update of city_ar on public.loc_catalog_city
  for each row execute function public.trg_location_names_squash_ws();
drop trigger if exists trg_squash_ws on public.loc_catalog_district;
create trigger trg_squash_ws before insert or update of district_ar on public.loc_catalog_district
  for each row execute function public.trg_location_names_squash_ws();
drop trigger if exists trg_squash_ws on public.listings_arabic_locations;
create trigger trg_squash_ws before insert or update of city_ar, district_ar on public.listings_arabic_locations
  for each row execute function public.trg_location_names_squash_ws();
drop trigger if exists trg_squash_ws on public.search_listings_ar;
create trigger trg_squash_ws before insert or update of city_ar, district_ar on public.search_listings_ar
  for each row execute function public.trg_location_names_squash_ws();

create or replace function public.location_whitespace_irregular_rows()
returns table (surface text, rows_irregular bigint, example text)
language sql stable security definer set search_path to 'public'
as $function$
  select 'loc_catalog_city', count(*), min(city_ar) from public.loc_catalog_city where city_ar is distinct from public.squash_ws(city_ar)
  union all
  select 'loc_catalog_district', count(*), min(district_ar) from public.loc_catalog_district
   where district_ar is distinct from public.squash_ws(district_ar)
  union all
  select 'listings_arabic_locations', count(*), min(coalesce(district_ar, city_ar)) from public.listings_arabic_locations
   where city_ar is distinct from public.squash_ws(city_ar) or district_ar is distinct from public.squash_ws(district_ar)
  union all
  select 'search_listings_ar', count(*), min(coalesce(district_ar, city_ar)) from public.search_listings_ar
   where city_ar is distinct from public.squash_ws(city_ar) or district_ar is distinct from public.squash_ws(district_ar)
$function$;
revoke all on function public.location_whitespace_irregular_rows() from public, anon, authenticated;

-- Repair through the triggers (each SET names the column, so the BEFORE UPDATE OF trigger squashes it).
update public.loc_catalog_city set city_ar = city_ar where city_ar is distinct from public.squash_ws(city_ar);
update public.loc_catalog_district set district_ar = district_ar where district_ar is distinct from public.squash_ws(district_ar);
update public.listings_arabic_locations set city_ar = city_ar, district_ar = district_ar
 where city_ar is distinct from public.squash_ws(city_ar) or district_ar is distinct from public.squash_ws(district_ar);
update public.search_listings_ar set city_ar = city_ar, district_ar = district_ar
 where city_ar is distinct from public.squash_ws(city_ar) or district_ar is distinct from public.squash_ws(district_ar);

create or replace function public.mon_detect_location_whitespace_irregular()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rows bigint; v_by jsonb; v_open text; r int := 0;
begin
  select coalesce(sum(x.rows_irregular), 0),
         coalesce(jsonb_agg(jsonb_build_object('surface', x.surface, 'rows', x.rows_irregular, 'example', x.example))
                    filter (where x.rows_irregular > 0), '[]'::jsonb)
    into v_rows, v_by
    from public.location_whitespace_irregular_rows() x;
  select severity into v_open from public.alert_event
   where dedup_key = 'location_whitespace_irregular' and resolved_at is null order by created_at desc limit 1;
  if v_rows = 0 then
    if v_open is not null then perform public.mon_resolve('location_whitespace_irregular', 'location_pipeline'); end if;
  elsif v_open is null then
    r := public.mon_raise('P2', 'location_whitespace_irregular', 'location_pipeline', 'location_whitespace_irregular',
      jsonb_build_object('rows', v_rows, 'by_surface', v_by,
        'why', 'A catalogue, bridge or served location name carries a doubled, leading or trailing space. trg_squash_ws '
               || 'squashes every write on these four tables, so a row here means the trigger is gone or bypassed.'));
  end if;
  return r;
end
$function$;
revoke all on function public.mon_detect_location_whitespace_irregular() from public, anon, authenticated;

-- Roster (an unrostered detector is decoration).
do $roster$
declare d text; anchor text := '''mon_detect_source_district_dropped'', '; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_location_whitespace_irregular''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_location_whitespace_irregular'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_location_whitespace_irregular''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF.
do $proof$
declare n bigint; v text;
begin
  select coalesce(sum(rows_irregular), 0) into n from public.location_whitespace_irregular_rows();
  if n <> 0 then raise exception 'PROOF: % irregular names remain after the repair', n; end if;
  if (select district_ar from public.loc_catalog_district where district_id = 3728) <> 'حي السبهاني' then
    raise exception 'PROOF: «حي السبهاني» was not repaired';
  end if;
  begin
    update public.loc_catalog_district set district_ar = ' حي  السبهاني ' where district_id = 3728 returning district_ar into v;
    if v <> 'حي السبهاني' then raise exception 'PROOF: the trigger did not squash a doubled space (got «%»)', v; end if;
    drop trigger trg_squash_ws on public.loc_catalog_district;
    update public.loc_catalog_district set district_ar = 'حي  السبهاني' where district_id = 3728;
    select coalesce(sum(rows_irregular), 0) into n from public.location_whitespace_irregular_rows();
    if n <> 1 then raise exception 'PROOF: with the trigger gone the detector saw % rows, want 1', n; end if;
    raise exception 'ROLLBACK_PROOF';
  exception when others then
    if sqlerrm <> 'ROLLBACK_PROOF' then raise; end if;
  end;
  if not exists (select 1 from pg_trigger where tgname = 'trg_squash_ws' and tgrelid = 'public.loc_catalog_district'::regclass) then
    raise exception 'PROOF: the rollback lost the trigger';
  end if;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_location_whitespace_irregular') <> 0 then
    raise exception 'PROOF: the new detector reads as orphaned';
  end if;
  raise notice 'PROOF OK: repaired, the trigger squashes, the detector catches a bypass, rostered';
end $proof$;
