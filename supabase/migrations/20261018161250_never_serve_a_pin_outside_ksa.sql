-- APPLIED 2026-10-18 (owner session). P1 (owner rule: a location fix includes the map): never serve a pin outside Saudi.
--
-- THE DEFECT: 134 production_ready rows carried a lat/lng outside the KSA box (16–32.5 N, 34–56 E) and the ad page drew it
-- as the map: 59 at exactly (0,0) (sirdab 38, eaqartabuk 11, dealapp 10), ~45 at ~(0.0002, 0.0004) off West Africa
-- (dealapp 29, wasalt ~30, sanadak, aqaratikom, vmksa — the SAME values on several sites: a shared upstream pin), swapped
-- pairs (wasalt 5792032 «lat 46.83 lon 24.85», eastabha 595489), metres (jurash 182454/424144, goldendeal), Cairo
-- (gomenassat 30.04/31.23), England (gathern 733460 51.18/-1.83), wasalt 5803420 (11.25, 26.00).
-- The extractors are faithful: each copies the site's own field (sirdab p.get("lat"), gathern it.get("lat"), …), and
-- wasalt's own page payload carries exactly «"lat":"0.00021898991578503168"» for 5883987 (read live 2026-10-18). So the
-- stored value stays the source's (SOURCE IS TRUTH); what changes is what WE serve — a point outside the kingdom is not a
-- location we can claim, so the index serves NULL and the ad page falls back to the district/city border by itself
-- (src/data/adPageData.ts mapPoint: no point → border, labelled approximate). Swapped pairs are NOT un-swapped: guessing.
--
-- WHERE: search_listings_ar.latitude/longitude are written only by sync_listing_rich_attrs() (job 28 via
-- sync_all_rich_attrs, job 68), whose SET and DIFF lists are built from the column names. Both now serve the pair only
-- when public.point_in_ksa(lat, lng); the DIFF uses the same expression, so a served NULL over a stored (0,0) is not
-- rewritten every hour.
create or replace function public.point_in_ksa(p_lat numeric, p_lng numeric) returns boolean
language sql immutable parallel safe as $$
  select p_lat between 16 and 32.5 and p_lng between 34 and 56
$$;

do $patch$
declare d text; a1 text; b1 text; a2 text; b2 text;
begin
  select pg_get_functiondef('public.sync_listing_rich_attrs(text)'::regprocedure) into d;
  a1 := $a$string_agg(format('%I = d.%I', c, c), ', ')$a$;
  b1 := $b$string_agg(case when c in ('latitude', 'longitude')
                           then format('%I = case when public.point_in_ksa(d.latitude, d.longitude) then d.%I end', c, c)
                           else format('%I = d.%I', c, c) end, ', ')$b$;
  a2 := $a$string_agg(format('s.%I is distinct from r.%I', c, c), ' or ')$a$;
  b2 := $b$string_agg(case when c in ('latitude', 'longitude')
                           then format('s.%I is distinct from (case when public.point_in_ksa(r.latitude, r.longitude) then r.%I end)', c, c)
                           else format('s.%I is distinct from r.%I', c, c) end, ' or ')$b$;
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 then raise exception 'anchor 1 (SET list) not found exactly once'; end if;
  if (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then raise exception 'anchor 2 (DIFF list) not found exactly once'; end if;
  execute replace(replace(d, a1, b1), a2, b2);
end
$patch$;

-- BACKFILL the served pairs (≤ 25k rule: it is ~134 rows)
update public.search_listings_ar
   set latitude = null, longitude = null
 where (latitude is not null or longitude is not null)
   and not coalesce(public.point_in_ksa(latitude, longitude), false);

-- DETECTOR: OUR claim — a pin we serve outside the kingdom. P1 to 🔧 (ops_engineer_for_alert default). Rostered.
create or replace function public.mon_detect_served_pin_outside_ksa()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_rows bigint; v_by jsonb; r int := 0;
begin
  select count(*), coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'rows', n) order by n desc), '[]'::jsonb)
    into v_rows, v_by
    from (select platform, count(*) n from public.search_listings_ar
           where (latitude is not null or longitude is not null)
             and not coalesce(public.point_in_ksa(latitude, longitude), false)
           group by platform) z;
  select coalesce(sum((e->>'rows')::bigint), 0) into v_rows from jsonb_array_elements(v_by) e;
  if v_rows = 0 then
    if exists (select 1 from public.alert_event where dedup_key = 'served_pin_outside_ksa' and resolved_at is null) then
      perform public.mon_resolve('served_pin_outside_ksa', 'location');
    end if;
  elsif not exists (select 1 from public.alert_event where dedup_key = 'served_pin_outside_ksa' and resolved_at is null) then
    r := public.mon_raise('P1', 'served_pin_outside_ksa', 'location', 'served_pin_outside_ksa',
      jsonb_build_object('rows', v_rows, 'per_platform', v_by, 'for', '🔧',
        'why', 'We serve a map pin outside Saudi Arabia (box 16–32.5 N, 34–56 E): the ad page draws it in the ocean, Cairo or England. The write path is sync_listing_rich_attrs() (SET/DIFF wrap latitude/longitude in point_in_ksa) — check it still does, then re-run it. Never «fix» by swapping or guessing a pin; NULL lets the page show the district border.'));
  end if;
  return r;
end $function$;

do $roster$
declare d text; anchor text := '''mon_detect_city_bridge_poisoned'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_served_pin_outside_ksa''' in d) = 0 then
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    execute replace(d, anchor, '''mon_detect_served_pin_outside_ksa'', ' || anchor);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_served_pin_outside_ksa''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF
do $proof$
declare left_out bigint; lid bigint; got numeric; n bigint;
begin
  if public.point_in_ksa(0, 0) or public.point_in_ksa(46.837, 24.850) or public.point_in_ksa(30.0443, 31.2357)
     or public.point_in_ksa(51.18, -1.83) or public.point_in_ksa(182454, 424144) or public.point_in_ksa(0.000219, 0.000356)
     or not public.point_in_ksa(24.7136, 46.6753) or not public.point_in_ksa(21.4858, 39.1925) or not public.point_in_ksa(26.4207, 50.0888)
     or not public.point_in_ksa(17.4924, 44.1277) or not public.point_in_ksa(31.6707, 38.6619) then
    raise exception 'PROOF: point_in_ksa() misjudges a recorded point';
  end if;
  select count(*) into left_out from public.search_listings_ar
   where (latitude is not null or longitude is not null) and not coalesce(public.point_in_ksa(latitude, longitude), false);
  if left_out <> 0 then raise exception 'PROOF: % served pins still outside KSA', left_out; end if;
  -- the real write path, executed: a sirdab row whose stored pin is (0,0) stays served as NULL, and a re-run writes nothing
  -- for it (SET and DIFF agree)
  select s.listing_id into lid from public.search_listings_ar s join public.listing_rich_attrs r
      on r.source_table = s.source_table and r.listing_id = s.listing_id
   where s.source_table = 'sirdab_commercial_listings' and r.latitude = 0 and r.longitude = 0 limit 1;
  if lid is null then raise exception 'PROOF: no sirdab (0,0) row to execute the write path on'; end if;
  n := public.sync_listing_rich_attrs('sirdab_commercial_listings');
  if n is null then raise exception 'PROOF: the search writer lock was busy — re-apply after the sync'; end if;
  select latitude into got from public.search_listings_ar where source_table = 'sirdab_commercial_listings' and listing_id = lid;
  if got is not null then raise exception 'PROOF: the rich sync served the (0,0) pin again'; end if;
  begin
    update public.search_listings_ar set latitude = 0, longitude = 0 where source_table = 'sirdab_commercial_listings' and listing_id = lid;
    if public.mon_detect_served_pin_outside_ksa() is null then null; end if;
    if not exists (select 1 from public.alert_event where dedup_key = 'served_pin_outside_ksa' and resolved_at is null) then
      raise exception 'PROOF: a served (0,0) pin did not raise served_pin_outside_ksa';
    end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_served_pin_outside_ksa') <> 0 then
    raise exception 'PROOF: the detector reads as orphaned';
  end if;
  raise notice 'PROOF OK: 0 served pins outside KSA; the rich sync keeps (0,0) as NULL (% rows written by its pass); a planted pin raises P1', n;
end
$proof$;
