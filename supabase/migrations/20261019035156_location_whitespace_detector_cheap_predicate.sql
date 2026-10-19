-- The whitespace detector (20261019035034) read every served name through squash_ws(): 4.5 s per run on 400k index
-- rows. has_irregular_ws() asks the same question with LIKE / strpos (167 ms): a doubled space, a leading or trailing
-- space, or a tab / newline / carriage return. Proof below: it agrees with squash_ws() on every case, and the detector
-- still sees a bypassed trigger.
set local lock_timeout = '5s';

create or replace function public.has_irregular_ws(v text) returns boolean
language sql immutable parallel safe set search_path to 'public'
as $function$
  select v like '%  %' or v like ' %' or v like '% '
      or strpos(v, E'\t') > 0 or strpos(v, E'\n') > 0 or strpos(v, E'\r') > 0
$function$;

create or replace function public.location_whitespace_irregular_rows()
returns table (surface text, rows_irregular bigint, example text)
language sql stable security definer set search_path to 'public'
as $function$
  select 'loc_catalog_city', count(*), min(city_ar) from public.loc_catalog_city where public.has_irregular_ws(city_ar)
  union all
  select 'loc_catalog_district', count(*), min(district_ar) from public.loc_catalog_district where public.has_irregular_ws(district_ar)
  union all
  select 'listings_arabic_locations', count(*), min(coalesce(district_ar, city_ar)) from public.listings_arabic_locations
   where public.has_irregular_ws(city_ar) or public.has_irregular_ws(district_ar)
  union all
  select 'search_listings_ar', count(*), min(coalesce(district_ar, city_ar)) from public.search_listings_ar
   where public.has_irregular_ws(city_ar) or public.has_irregular_ws(district_ar)
$function$;
revoke all on function public.location_whitespace_irregular_rows() from public, anon, authenticated;

do $proof$
declare t text; n bigint;
begin
  foreach t in array array['حي  السبهاني', ' حي السبهاني', 'حي السبهاني ', E'حي\tالسبهاني', E'حي\nالسبهاني', E'حي\rالسبهاني',
                           'حي السبهاني', 'السبهاني', ''] loop
    if public.has_irregular_ws(t) is distinct from (t is distinct from public.squash_ws(t)) then
      raise exception 'PROOF: has_irregular_ws and squash_ws disagree on «%»', t;
    end if;
  end loop;
  begin
    drop trigger trg_squash_ws on public.loc_catalog_district;
    update public.loc_catalog_district set district_ar = 'حي  السبهاني' where district_id = 3728;
    select coalesce(sum(rows_irregular), 0) into n from public.location_whitespace_irregular_rows();
    if n <> 1 then raise exception 'PROOF: with the trigger gone the detector saw % rows, want 1', n; end if;
    raise exception 'ROLLBACK_PROOF';
  exception when others then
    if sqlerrm <> 'ROLLBACK_PROOF' then raise; end if;
  end;
  select coalesce(sum(rows_irregular), 0) into n from public.location_whitespace_irregular_rows();
  if n <> 0 then raise exception 'PROOF: % irregular names after the rollback', n; end if;
end $proof$;
