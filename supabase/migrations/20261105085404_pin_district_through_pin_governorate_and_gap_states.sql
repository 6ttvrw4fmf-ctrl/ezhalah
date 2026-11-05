-- PIN DISTRICTS SURVIVE A PIN-GOVERNORATE CITY, AND THE GAP DETECTOR TELLS A SITE-RESOLVED AD FROM A DROPPED PIN
-- (follow-up to 20261105085039, owner 2026-11-05). Its first read found 6 switched-on pin rows still served blank:
--   * manzo 21173444/21173445 (الخرج): city from the pin's governorate (listing_city_correction.city_source =
--     'pin_governorate'). That branch of listing_native_location_v2 looks the district up only from
--     xcc.district_norm, a VERBATIM recovery or the native field, so a pin (or title) recovery — verbatim = false by
--     design — was dropped. Now a 'pin'/'title' recovery is read there too; the lookup still requires the district to be
--     on the corrected city's list (kd.city_id = xcc.city_id, retired_at is null), so nothing off-list can be served.
--   * aqar 9141108, 8352625, 1088012, 14362153 (بلجرشي): the SITE's neighbourhood («الظفير», a الباحة district)
--     resolved in the raw city and wins over the pin by rule 1; the ad is blank because its city was corrected. That is a
--     city question, not a pin failure — the detector now calls it site_recovered_other_city, never P1.
set local lock_timeout = '15s';

do $mig$
declare
  d text := pg_get_viewdef('public.listing_native_location_v2'::regclass);
  old_txt constant text := 'WHEN dr.verbatim THEN norm_district_tok(dr.district_ar)';
  new_txt constant text := 'WHEN (dr.verbatim OR (dr.basis = ANY (ARRAY[''pin''::text, ''title''::text]))) THEN norm_district_tok(dr.district_ar)';
begin
  if (length(d) - length(replace(d, old_txt, ''))) / length(old_txt) <> 1 then
    raise exception 'listing_native_location_v2: pin_governorate verbatim branch not found exactly once';
  end if;
  execute 'create or replace view public.listing_native_location_v2 as ' || replace(d, old_txt, new_txt);
  d := pg_get_viewdef('public.listing_native_location_v2'::regclass);
  if position('dr.verbatim OR (dr.basis = ANY' in d) = 0 then
    raise exception 'listing_native_location_v2: pin_governorate patch did not land';
  end if;
end
$mig$;

create or replace function public.pin_district_gap_rows()
 returns table (source_table text, listing_id bigint, city_id integer, first_seen_at timestamptz, state text,
                apple_name text, pin_created_at timestamptz, in_recovery boolean)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with cov as (select d.city_id from public.loc_catalog_district d where d.retired_at is null group by 1 having count(*) >= 10),
  shared as (
    select round(s.latitude::numeric, 5) la, round(s.longitude::numeric, 5) lo
      from public.search_listings_ar s
     where s.production_ready and s.latitude is not null and s.longitude is not null
     group by 1, 2 having count(*) >= 5)
  select s.source_table, s.listing_id, s.city_id, s.first_seen_at,
         case when p.applied and r.basis is not null and r.basis <> 'pin' then 'site_recovered_other_city'
              when p.applied and r.listing_id is not null and r.basis is null then 'site_recovered_other_city'
              when p.applied then 'applied_not_served'
              when p.listing_id is not null then 'held_edge'
              when x.la is not null then 'shared_pin'
              when k.listing_id is null then 'never_asked'
              else k.outcome end,
         k.apple_name, p.created_at,
         coalesce(r.basis = 'pin', false)
    from public.search_listings_ar s
    join cov on cov.city_id = s.city_id
    left join public.listing_native_location_v1 v1 on v1.source_table = s.source_table and v1.listing_id = s.listing_id
    left join public.listing_pin_district p on p.source_table = s.source_table and p.listing_id = s.listing_id
    left join public.listing_pin_ask k on k.source_table = s.source_table and k.listing_id = s.listing_id
    left join public.district_recovery r on r.source_table = s.source_table and r.listing_id = s.listing_id
    left join shared x on x.la = round(s.latitude::numeric, 5) and x.lo = round(s.longitude::numeric, 5)
   where s.production_ready and (s.district_ar is null or btrim(s.district_ar) = '')
     and s.latitude is not null and s.longitude is not null
     and (nullif(btrim(v1.district_ar), '') is null or public.district_is_own_town(s.city_id, v1.district_ar))
     and not exists (select 1 from public.listing_source_district_ar sd
                      where sd.source_table = s.source_table and sd.listing_id = s.listing_id
                        and not public.district_is_own_town(s.city_id, sd.source_district_ar))
     and not exists (select 1 from public.listing_title_district lt where lt.source_table = s.source_table and lt.listing_id = s.listing_id)
$function$;

revoke all on function public.pin_district_gap_rows() from public, anon, authenticated;

-- PROOF: the two manzo ads now read their pin district through v2; the four بلجرشي ads are not «applied_not_served».
do $proof$
declare v text; k int;
begin
  select v2.district_ar into v from public.listing_native_location_v2 v2
   where v2.source_table = 'manzo_residential_listings' and v2.listing_id = 21173445;
  if v is distinct from 'حي الرفيعة' then raise exception 'PROOF: manzo 21173445 v2 district is %, want حي الرفيعة', v; end if;
  select count(*) into k from public.pin_district_gap_rows() g
   where g.source_table = 'aqar_residential_listings' and g.listing_id in (9141108, 8352625, 1088012, 14362153)
     and g.state = 'applied_not_served';
  if k <> 0 then raise exception 'PROOF: % site-resolved بلجرشي ads still read as a dropped pin', k; end if;
  raise notice 'PROOF OK: pin district served through the pin_governorate branch; site-resolved ads classified';
end $proof$;
