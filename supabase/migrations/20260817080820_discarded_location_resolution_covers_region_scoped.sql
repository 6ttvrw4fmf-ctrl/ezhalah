-- Data Integrity run #26 (2026-08-17), follow-up to v2_city_region_scoped_resolution_fallback.
--
-- The barrier created earlier this run only counted a discarded resolution when the resolved city
-- name is unique across the WHOLE catalog. The second fix (ulg2) also recovers rows whose name is
-- ambiguous globally but unique inside the region recorded on the same resolution row. Without
-- this edit, a regression in the ulg2 branch would be completely unmonitored -- the exact
-- "barrier that cannot see the thing it protects" failure this run has already documented twice.
--
-- Same gate, same rule: still count(DISTINCT ...) = 1, merely evaluated within the recorded
-- region. A name that is ambiguous even inside its own region is still NOT a leak and must stay
-- NULL (§6 "Never guess"). Currently 0 such rows.
--
-- Measured cost after this change: re-timed below 60 ms, well inside the 30-minute sweep budget.

create or replace function public.mon_detect_discarded_location_resolution()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; cnt int; sample jsonb;
begin
  select count(*) into cnt
    from public.search_listings_ar s
   where s.city_id is null
     and exists (
       select 1 from public.listings_arabic_locations l
        where l.source_table = s.source_table
          and l.listing_id  = s.listing_id
          and l.matched and l.city_ar is not null
          and (
            -- (a) unambiguous across the whole catalog
            (select count(distinct cc.city_id) from public.loc_catalog_city cc
              where cc.city_norm = public.normalize_ar(l.city_ar)) = 1
            or
            -- (b) ambiguous by name, but unambiguous inside the region recorded beside it
            (l.region_ar is not null
             and (select count(distinct cc.city_id)
                    from public.loc_catalog_city cc
                    join public.loc_catalog_region cr on cr.region_id = cc.region_id
                   where cc.city_norm = public.normalize_ar(l.city_ar)
                     and cr.region_ar = l.region_ar) = 1)
          ));

  if coalesce(cnt, 0) > 0 then
    select jsonb_agg(x) into sample from (
      select s.source_table, s.listing_id, s.platform, s.city_ar as search_city_ar,
             l.city_ar as resolved_city_ar, l.region_ar as resolved_region_ar
        from public.search_listings_ar s
        join public.listings_arabic_locations l
          on l.source_table = s.source_table and l.listing_id = s.listing_id
       where s.city_id is null
         and l.matched and l.city_ar is not null
         and (
           (select count(distinct cc.city_id) from public.loc_catalog_city cc
             where cc.city_norm = public.normalize_ar(l.city_ar)) = 1
           or (l.region_ar is not null
               and (select count(distinct cc.city_id)
                      from public.loc_catalog_city cc
                      join public.loc_catalog_region cr on cr.region_id = cc.region_id
                     where cc.city_norm = public.normalize_ar(l.city_ar)
                       and cr.region_ar = l.region_ar) = 1)
         )
       order by s.source_table, s.listing_id limit 20) x;

    n := public.mon_raise('P1', 'discarded_location_resolution', 'all', 'discarded_location_resolution',
      jsonb_build_object(
        'count', cnt,
        'sample', sample,
        'why', 'These listings have a matched=true resolution in listings_arabic_locations that identifies EXACTLY ONE canonical catalog city - either unambiguously by name, or unambiguously within the region recorded on the same resolution row - yet search_listings_ar.city_id is NULL. They are therefore production_ready=false and NO Filter combination can return them. Ezhalah computed the answer and discarded it. This is NOT a source limitation: the resolution already exists in our own tables. Check the fallback chain in listing_native_location_v2 (COALESCE v1.city_id -> uali -> ulg -> ulg2 -> uc) and the precedence in listing_native_location_v1.best, which must never let a native row that resolves to NULL outrank a legacy row that resolves to a city.',
        'do_not', 'Do NOT fix this by writing a city onto the listing table, and do NOT relax either unambiguity gate. A name that is ambiguous even inside its own recorded region is excluded here on purpose and must stay NULL.'));
  else
    perform public.mon_resolve_key('discarded_location_resolution', 'discarded_location_resolution');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_discarded_location_resolution() is
  'Run #26 (2026-08-17): fires when a listing has a matched resolution identifying exactly one canonical city - by name, or within its recorded region - but search_listings_ar.city_id is still NULL, i.e. Ezhalah resolved the city and the pipeline threw it away. Covers both recovery branches (ulg globally-unique, ulg2 region-scoped). Baseline at creation: 0, after 48 rows were recovered. Names ambiguous even within their own region are deliberately excluded and must remain NULL.';

do $assert$
declare v_cnt int;
begin
  select public.mon_detect_discarded_location_resolution() into v_cnt;
  if v_cnt <> 0 then
    raise exception 'detector raised % on a state that was just verified clean', v_cnt;
  end if;
  if position('mon_detect_discarded_location_resolution' in
      pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'detector is no longer on the roster';
  end if;
end
$assert$;
