-- mon_detect_city_duplicate_orphaned_districts() kept 4 alerts open (الدرب 1862→3402, بيش 1667→3462,
-- السليمي 284→2702, البدائع 2358→2481) whose "dead twin" was RETIRED on 2026-10-26 (retired_at set),
-- four days before the alerts were raised. A retired city is out of the catalog: the district picker
-- (district_options_ar) is keyed by the live city_id the listings carry, and every place-resolver that
-- looks at a twin already filters retired_at is null (district_place_hidden, district_is_other_town,
-- refresh_title_district). The premise the alert states — "the district picker for this city is
-- reading the empty twin" — is false for a retired twin, and the twins also sit in different
-- region_ids, so the 20260923234716 recipe (move districts across) would be a cross-region move.
-- The detector now considers only non-retired dead twins; everything else is unchanged.
CREATE OR REPLACE FUNCTION public.mon_detect_city_duplicate_orphaned_districts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_keys text[] := '{}';
  v_raised int := 0;
  r record;
begin
  for r in
    with live_by_city as (
      select city_id, count(*) as n from public.search_listings_ar
      where production_ready = true group by city_id
    ),
    dead_candidates as (
      select c.city_id, c.city_ar, c.city_norm,
             (select count(*) from public.loc_catalog_district d where d.city_id = c.city_id) as districts
      from public.loc_catalog_city c
      where c.city_id in (select distinct city_id from public.loc_catalog_district)
        and c.retired_at is null
        and coalesce((select l.n from live_by_city l where l.city_id = c.city_id), 0) = 0
    )
    select dc.city_id as dead_city_id, dc.city_ar, dc.districts as dead_districts,
           tw.city_id as live_city_id, l.n as live_listings
    from dead_candidates dc
    join public.loc_catalog_city tw on tw.city_norm = dc.city_norm and tw.city_id <> dc.city_id
    join live_by_city l on l.city_id = tw.city_id
    where l.n > 0
  loop
    v_keys := v_keys || ('city_duplicate_orphaned_districts:' || r.dead_city_id || ':' || r.live_city_id);
    perform public.mon_raise('P2', 'city_duplicate_orphaned_districts', 'all',
      'city_duplicate_orphaned_districts:' || r.dead_city_id || ':' || r.live_city_id,
      jsonb_build_object(
        'city_ar', r.city_ar,
        'dead_city_id', r.dead_city_id, 'dead_city_owns_districts', r.dead_districts,
        'live_city_id', r.live_city_id, 'live_city_listings', r.live_listings,
        'why', 'two loc_catalog_city rows share the same name/norm token; the district catalog sits '
            || 'on the one with zero listings while the other holds all the real inventory — the '
            || 'district picker for this city is reading the empty twin',
        'fix', 'move loc_catalog_district + non-colliding loc_canonical_district rows from '
            || 'dead_city_id to live_city_id, mirror as a migration (see 20260923234716)'));
    v_raised := v_raised + 1;
  end loop;

  perform public.mon_resolve_stale_keys('city_duplicate_orphaned_districts', v_keys);
  return v_raised;
end;
$function$;