-- AN AD WHOSE OWN SITE GIVES NO CITY IS PLACED BY ITS OWN MAP PIN — only when the pin is plainly inside one city.
--
-- Owner 2026-11-10/11, asked «may ads whose site gives no city be placed by their map pin?» → «Yeah of course».
-- Before this, every such ad stayed out of search (production_ready = false, city_id null): ~460 of them carried a
-- pin (dealapp 93, wasalt 76, aqarcity 49, gathern 32, ramzalqasim 20, sanadak 19, aldarim 13, …).
--
-- THE RULE (all must hold; measured, not guessed):
--   * the site gives NO city, NO city name and NO region (the served row has none of them — an ad whose site names a
--     place we do not list is NOT «no city» and is left alone);
--   * the pin is in Saudi Arabia's box and inside a governorate boundary (loc_gov_shape_sub);
--   * the nearest city centre (loc_city_center, the median pin of a city's own homes, ≥ 20 homes) is ≤ 15 km away,
--     the second nearest is ≥ 15 km away AND ≥ 2× as far, and that nearest centre is in the SAME governorate as the pin.
-- Exam 2026-11-11 on 4,844 served ads whose city we already know: the rule picked 1,982 and named the right city for
-- 1,935 (97.6 %). Without the «second ≥ 15 km» clause it was 95.4 % — the misses were twin towns metres apart (the
-- الأحساء towns, الخبر/الظهران), which that clause now skips. Of the 263 pinned ads whose site gives truly no city, 65
-- are placed on the first run (ramzalqasim 20, gathern 14, aldarim 7, alobid 6, aqarcity 6, muktamel 4, dealapp 3,
-- raghdan 2, eastabha 2, aqarmonthly 1); the rest sit out in the countryside, far from any city on our list, and stay
-- hidden (honest unknown, never a guess).
--
-- HOW IT IS SERVED: one row per ad in listing_city_correction, city_source = 'pin_nearest_city'.
--   * Ads in listing_native_location_v1: listing_native_location_v2 already reads that table FIRST
--     (COALESCE(xcc.city_id, v1.city_id, …)), so the row is deleted the moment the site names a city or region of its
--     own (every run, before the hourly sync) — the site's word always wins.
--   * Ads outside v1 (dealapp, aqarcity, gathern, ramzalqasim, … — v2's «unresolved_catchall» arm) never read the table.
--     This migration splices the pin row into that arm LAST: COALESCE(<site>, <site>, <site>, pin), so the site's word
--     wins there by construction. The splice reads the live view body and fails unless every edit lands exactly once.
-- A placed ad is served with that city and no district (the pin-district arm may add one later). Search is untouched.
--
-- Undo: delete from listing_city_correction where city_source = 'pin_nearest_city'; and unschedule the job.

create or replace function public.pin_city_for_cityless_rows()
returns table (source_table text, listing_id bigint, platform text, city_id integer, km_nearest numeric, km_second numeric)
language sql stable
set search_path to 'public', 'extensions'
as $$
  with h as (
    -- served with no city, no city name and no region: the site gave none (an unknown place NAME is not «no city»)
    select s.source_table, s.listing_id, s.platform, s.latitude::float8 as lat, s.longitude::float8 as lon
      from public.search_listings_ar s
     where s.city_id is null
       and nullif(btrim(coalesce(s.city_ar, '')), '') is null and nullif(btrim(coalesce(s.region_ar, '')), '') is null
       and s.latitude between 16 and 33 and s.longitude between 34 and 56
       and not exists (select 1 from public.listing_city_correction x
                        where x.source_table = s.source_table and x.listing_id = s.listing_id
                          and x.city_source <> 'pin_nearest_city')),
  n as (
    select h.*, a.city_id as c1, a.km as d1, b.km as d2,
           (select g.gov_shape_id from public.loc_gov_shape_sub g
             where st_intersects(g.geom, st_setsrid(st_makepoint(h.lon, h.lat), 4326)) limit 1) as pin_gid
      from h
      cross join lateral (
        select cc.city_id, 111.0 * sqrt(power(cc.lat - h.lat, 2) + power((cc.lng - h.lon) * cos(radians(h.lat)), 2)) as km
          from public.loc_city_center cc join public.loc_catalog_city c on c.city_id = cc.city_id and c.retired_at is null
         where cc.ads >= 20 order by 2 limit 1) a
      cross join lateral (
        select 111.0 * sqrt(power(cc.lat - h.lat, 2) + power((cc.lng - h.lon) * cos(radians(h.lat)), 2)) as km
          from public.loc_city_center cc join public.loc_catalog_city c on c.city_id = cc.city_id and c.retired_at is null
         where cc.ads >= 20 and cc.city_id <> a.city_id order by 1 limit 1) b)
  select n.source_table, n.listing_id, n.platform, n.c1, round(n.d1::numeric, 2), round(n.d2::numeric, 2)
    from n
   where n.pin_gid is not null
     and n.d1 <= 15 and n.d2 >= 15 and n.d2 >= 2 * n.d1
     and n.pin_gid = (select g.gov_shape_id from public.loc_city_center cc
                        join public.loc_gov_shape_sub g on st_intersects(g.geom, st_setsrid(st_makepoint(cc.lng, cc.lat), 4326))
                       where cc.city_id = n.c1 limit 1)
$$;

create or replace function public.refresh_pin_city_for_cityless(p_apply boolean default true)
returns jsonb
language plpgsql
set search_path to 'public', 'extensions'
as $$
declare v_site_wins bigint := 0; v_dropped bigint := 0; v_added bigint := 0; v_found bigint;
begin
  create temp table _pc on commit drop as select * from public.pin_city_for_cityless_rows();
  select count(*) into v_found from _pc;
  if p_apply then
    -- the site now names a city or region of its own → its word wins, our pin row goes
    delete from public.listing_city_correction x
     using public.listing_native_location_v1 v1
     where x.city_source = 'pin_nearest_city'
       and v1.source_table = x.source_table and v1.listing_id = x.listing_id
       and (v1.city_id is not null or v1.region_id is not null or nullif(btrim(coalesce(v1.city_ar, '')), '') is not null);
    get diagnostics v_site_wins = row_count;
    -- the ad is gone from the index (inactive / removed) → nothing to place
    delete from public.listing_city_correction x
     where x.city_source = 'pin_nearest_city'
       and not exists (select 1 from public.search_listings_ar s
                        where s.source_table = x.source_table and s.listing_id = x.listing_id);
    get diagnostics v_dropped = row_count;
    -- district_norm '' = no district from the pin (the same empty marker pin_governorate rows use)
    insert into public.listing_city_correction (source_table, listing_id, city_id, city_source, district_norm)
    select p.source_table, p.listing_id, p.city_id, 'pin_nearest_city', '' from _pc p
    on conflict (source_table, listing_id) do nothing;
    get diagnostics v_added = row_count;
  end if;
  return jsonb_build_object('qualifying', v_found, 'added', v_added, 'site_now_names_a_city', v_site_wins,
                            'gone_from_index', v_dropped, 'applied', p_apply);
end $$;

revoke all on function public.pin_city_for_cityless_rows() from public, anon, authenticated;
revoke all on function public.refresh_pin_city_for_cityless(boolean) from public, anon, authenticated;

-- Every hour at :12, ten minutes before the index sync (job 28, :22), so a new arrival is placed the same hour.
select cron.schedule('pin-city-for-cityless', '12 * * * *',
  $c$set statement_timeout to '300s'; select public.refresh_pin_city_for_cityless(true)$c$);

-- THE ALARM (cheap, runs every sweep): the job stopped, or a pin row it wrote is not what search serves.
-- Silence must never read as health: a job that did not run contributes no row, so its ABSENCE is what is checked.
create or replace function public.mon_detect_pin_city_cityless_unplaced()
returns integer language plpgsql security definer
set search_path to 'public', 'extensions'
as $$
declare n int := 0; v_last timestamptz; v_unserved int; v_examples jsonb;
begin
  select max(d.end_time) into v_last
    from cron.job j join cron.job_run_details d on d.jobid = j.jobid
   where j.jobname = 'pin-city-for-cityless' and d.status = 'succeeded';
  select count(*), coalesce(jsonb_agg(jsonb_build_object('table', z.source_table, 'id', z.listing_id)) filter (where z.rn <= 5), '[]'::jsonb)
    into v_unserved, v_examples
    from (select x.source_table, x.listing_id, row_number() over (order by x.listing_id) rn
            from public.listing_city_correction x
            join public.search_listings_ar s on s.source_table = x.source_table and s.listing_id = x.listing_id
           where x.city_source = 'pin_nearest_city' and x.corrected_at < now() - interval '2 hours'
             and s.city_id is null) z;
  if v_last is null or v_last < now() - interval '3 hours' or v_unserved > 0 then
    n := public.mon_raise('P2', 'pin_city_cityless_unplaced', 'all', 'pin_city_cityless_unplaced',
      jsonb_build_object('last_successful_run', v_last, 'pin_rows_not_served', v_unserved, 'examples', v_examples,
        'why', 'ads whose site gives no city are placed by their own pin (cron pin-city-for-cityless, :12 hourly, '
            || 'then the :22 sync). Either the job has not succeeded for 3 hours, or a pin row it wrote 2+ hours ago '
            || 'is still served with no city — so those ads stay out of search.',
        'fix', 'check cron.job_run_details for pin-city-for-cityless; run select refresh_pin_city_for_cityless(true) and '
            || 'the next sync; for an unserved row check listing_native_location_v2 reads it. Never widen the rule.'));
  else
    perform public.mon_resolve('pin_city_cityless_unplaced', 'all');
  end if;
  return n;
end $$;

revoke all on function public.mon_detect_pin_city_cityless_unplaced() from public, anon, authenticated;

-- Roster entry in the SAME migration: read the live body, splice one name in, execute. Never a pasted body.
do $$
declare src text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  if position('mon_detect_pin_city_cityless_unplaced' in src) = 0 then
    src := replace(src,
      $q$'mon_detect_named_city_spelling_unplaced',$q$,
      $q$'mon_detect_named_city_spelling_unplaced',
    'mon_detect_pin_city_cityless_unplaced',$q$);
    if position('mon_detect_pin_city_cityless_unplaced' in src) = 0 then
      raise exception 'could not splice mon_detect_pin_city_cityless_unplaced into mon_run_all_detectors';
    end if;
    execute src;
  end if;
end $$;

-- v2's «unresolved_catchall» arm reads the pin row LAST (the site's own word first). Live body, exact edits, or fail.
do $$
declare src text; out text;
  procedure_note text := 'listing_native_location_v2 catch-all arm';
  function_edit_count int;
begin
  perform set_config('lock_timeout', '5s', true);
  src := pg_get_viewdef('public.listing_native_location_v2'::regclass);
  if position('xpc.city_id' in src) > 0 then return; end if;
  out := src;
  out := replace(out, 'COALESCE(lalc.region_id, lalc2.region_id, gth.region_id)', 'COALESCE(lalc.region_id, lalc2.region_id, gth.region_id, xpc.region_id)');
  out := replace(out, 'COALESCE(lalc.city_id, lalc2.city_id, gth.city_id)', 'COALESCE(lalc.city_id, lalc2.city_id, gth.city_id, xpc.city_id)');
  out := replace(out, 'COALESCE(lalc.city_ar, lalc2.city_ar, gcat.city_ar)', 'COALESCE(lalc.city_ar, lalc2.city_ar, gcat.city_ar, xpc.city_ar)');
  out := replace(out, 'COALESCE(lalc.region_ar, lalc2.region_ar, gcr2.region_ar)', 'COALESCE(lalc.region_ar, lalc2.region_ar, gcr2.region_ar, xpc.region_ar)');
  out := replace(out, $q$ELSE 'unresolved_catchall'::text$q$, $q$WHEN (xpc.city_id IS NOT NULL) THEN 'pin_nearest_city'::text
                    ELSE 'unresolved_catchall'::text$q$);
  out := replace(out, E'FROM (((((((active_listing_ids_v2 a\n',
    E'FROM ((((((((active_listing_ids_v2 a\n'
    || E'             LEFT JOIN LATERAL ( SELECT xc.city_id, xc.region_id, xc.city_ar, xr.region_ar\n'
    || E'                   FROM ((listing_city_correction x\n'
    || E'                     JOIN loc_catalog_city xc ON ((xc.city_id = x.city_id)))\n'
    || E'                     LEFT JOIN loc_catalog_region xr ON ((xr.region_id = xc.region_id)))\n'
    || E'                  WHERE ((x.source_table = a.source_table) AND (x.listing_id = a.listing_id) AND (x.city_source = ''pin_nearest_city''::text))) xpc ON (true))\n');
  select count(*) into function_edit_count from regexp_matches(out, 'xpc\.', 'g');
  -- 2 region + 2 city + 1 city_ar + 1 region_ar + 1 CASE = 7 references
  if function_edit_count <> 7 or position('LEFT JOIN LATERAL ( SELECT xc.city_id' in out) = 0 then
    raise exception '% splice did not land exactly (xpc refs %, expected 7)', procedure_note, function_edit_count;
  end if;
  execute 'create or replace view public.listing_native_location_v2 as ' || out;
end $$;

-- First run now, so the qualifying ads are placed before the next sync.
select public.refresh_pin_city_for_cityless(true);
