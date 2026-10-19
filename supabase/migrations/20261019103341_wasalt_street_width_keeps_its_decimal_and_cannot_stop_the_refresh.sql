-- wasalt street width keeps its decimal point, and one odd value can no longer stop the hourly pipeline
-- (🔬 AF engineer, 2026-10-19). The wasalt arms of listing_extra_attrs_v0 read «propertyStreetWidth» by deleting every
-- non-digit and casting to smallint, so the decimal point vanished: 173 active ads were served ×10 or ×100
-- («8.1 م» → 81, «15.25 م» → 1525, «3.5 م» → 35), and a customer asking for a 15 m+ street got a 3.5 m lane. On
-- 10-19 one ad typed «457.92 م» → 45792, past smallint, and refresh_listing_native_location_v1 (cron 17) failed at
-- 08:20, 09:20 and 10:20: listing_extra_attrs_mv, active_listing_ids_v2 and listing_native_location_v1 stayed frozen
-- at 07:20 for every website (P1 cron_flapping:17). The first number is now read with its decimal, truncated (14.6 m
-- never answers «15+»), and a value that cannot fit is NULL instead of an error. The figure stays the source's own.
do $m$
declare
  v text := pg_get_viewdef('public.listing_extra_attrs_v0'::regclass);
  o text := $q$(NULLIF(regexp_replace((e.value ->> 'value'::text), '[^0-9]'::text, ''::text, 'g'::text), ''::text))::smallint AS "nullif"$q$;
  n text := $q$(CASE WHEN trunc((substring(replace((e.value ->> 'value'::text), '٫'::text, '.'::text) from '[0-9]+(?:\.[0-9]+)?'::text))::numeric) <= 32767::numeric THEN (trunc((substring(replace((e.value ->> 'value'::text), '٫'::text, '.'::text) from '[0-9]+(?:\.[0-9]+)?'::text))::numeric))::smallint ELSE NULL::smallint END) AS "nullif"$q$;
  hits int;
begin
  hits := (length(v) - length(replace(v, o, ''))) / length(o);
  if hits <> 2 then raise exception 'wasalt street width anchor matched % times (want 2: residential, commercial)', hits; end if;
  execute 'create or replace view public.listing_extra_attrs_v0 as ' || replace(v, o, n);
end $m$;

-- The class is gone: every wasalt street width served equals the truncated decimal its own attribute states, and the
-- whole view evaluates (the 10-19 refresh died on exactly this evaluation).
create or replace function public.wasalt_street_width_misread()
returns table (source_table text, listing_id bigint, raw text, served smallint)
language sql stable security definer set search_path to 'public'
as $f$
  with src as (
    select 'wasalt_residential_listings'::text as t, w.id, w.ar_data from public.wasalt_residential_listings w where w.active
    union all
    select 'wasalt_commercial_listings', w.id, w.ar_data from public.wasalt_commercial_listings w where w.active),
  raw as (
    select s.t, s.id, (select e.value ->> 'value' from jsonb_array_elements(s.ar_data -> 'additionalAttributes') e(value)
                        where e.value ->> 'key' = 'propertyStreetWidth' and e.value ->> 'value' ~ '[0-9]' limit 1) as raw
      from src s)
  select r.t, r.id, r.raw, a.street_width_m
    from raw r join public.listing_extra_attrs_v0 a on a.source_table = r.t and a.listing_id = r.id
   where r.raw ~ '[0-9][.٫][0-9]'
     and a.street_width_m is distinct from
         trunc((substring(replace(r.raw, '٫', '.') from '[0-9]+(?:\.[0-9]+)?'))::numeric)::int
$f$;
revoke all on function public.wasalt_street_width_misread() from public, anon, authenticated;

create or replace function public.mon_detect_wasalt_street_width_misread()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_n bigint; v_ex jsonb; r int := 0;
begin
  select count(*), (select jsonb_agg(to_jsonb(x)) from (select * from public.wasalt_street_width_misread() limit 8) x)
    into v_n, v_ex from public.wasalt_street_width_misread();
  if v_n = 0 then
    if exists (select 1 from public.alert_event where dedup_key = 'wasalt_street_width_misread' and resolved_at is null) then
      perform public.mon_resolve('wasalt_street_width_misread', 'wasalt');
    end if;
  elsif not exists (select 1 from public.alert_event where dedup_key = 'wasalt_street_width_misread' and resolved_at is null) then
    r := r + public.mon_raise('P1', 'wasalt_street_width_misread', 'wasalt', 'wasalt_street_width_misread',
      jsonb_build_object('rows', v_n, 'examples', v_ex, 'for', '🔬',
        'why', 'A wasalt street width is served as something other than the decimal its own propertyStreetWidth states (the 10-19 shape: the decimal point deleted, 8.1 m served as 81). A customer asking for a wide street is shown a narrow one. Fix the listing_extra_attrs_v0 wasalt arms.'));
  end if;
  return r;
end $function$;
revoke all on function public.mon_detect_wasalt_street_width_misread() from public, anon, authenticated;

do $roster$
declare d text; anchor text := '''mon_detect_city_bridge_poisoned'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_wasalt_street_width_misread''' in d) = 0 then
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    execute replace(d, anchor, '''mon_detect_wasalt_street_width_misread'', ' || anchor);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_wasalt_street_width_misread''' in d) = 0 then raise exception 'roster edit did not land'; end if;
  perform max(street_width_m), max(property_age) from public.listing_extra_attrs;
  if exists (select 1 from public.wasalt_street_width_misread()) then
    raise exception 'a wasalt street width is still misread';
  end if;
end
$roster$;