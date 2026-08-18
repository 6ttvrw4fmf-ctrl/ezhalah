-- Data Integrity run #29 follow-up: correcting the behavioural limb of
-- mon_detect_city_resolution_ignores_region() on its first live run.
--
-- The limb asserted that whenever listings_arabic_locations carries a region and a
-- catalog-ambiguous city name, the SERVED city must equal the region-scoped resolution of that
-- name. It reported 1,219 listings. Every one of them was my measurement, not a defect:
--
--   aqar_parser     893   served «أبو السداد» / المنطقة الشرقية while the lal row said «الباحة»
--   native_scraper  292   served «الأحساء»    / المنطقة الشرقية while the lal row said «الباحة»
--   phasea           33   served «الاحساء» while the lal row said «الهفوف»
--   legacy_derived    1
--
-- listings_arabic_locations is a FALLBACK overlay. When the platform's own parser or native scraper
-- supplies a city, that is the stronger evidence and it correctly outranks the overlay - which is
-- exactly the precedence listing_native_location_v2 implements. The limb was demanding that the
-- weakest source win, and «الباحة» happens to exist inside المنطقة الشرقية too, which is why those
-- rows looked "region-scoped resolvable" at all.
--
-- The invariant that actually needs enforcing is narrower: WHEN THE OVERLAY IS THE PATH THAT
-- SUPPLIES THE CITY, it must resolve within the published region. Rows whose city came from a
-- stronger source are outside this rule and are now excluded by source_method.
--
-- (The structural limb was right and reported 0 - every object that derives a city from a name
-- already consults loc_catalog_region.)

create or replace function public.mon_detect_city_resolution_ignores_region()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  structural jsonb;
  struct_n int := 0;
  behav_n int := 0;
  behav_sample jsonb;
begin
  -- ── limb 1: structural ───────────────────────────────────────────────────────────────────────
  with objs as (
    select 'function'::text kind, p.proname name, pg_get_functiondef(p.oid) body
      from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
     where n2.nspname = 'public' and p.prokind = 'f'
    union all
    select 'view', c.relname, pg_get_viewdef(c.oid, true)
      from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
     where n2.nspname = 'public' and c.relkind in ('v','m')
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'object', name) order by name), '[]'::jsonb),
         count(*)
    into structural, struct_n
  from objs o
  where o.body ~* 'loc_catalog_city'
    and (o.body ~* 'city_norm' or o.body ~* 'normalize_ar\s*\(\s*[a-z0-9_.]*city')
    and o.body !~* 'loc_catalog_region'
    and o.name not like 'mon\_%'
    and not exists (select 1 from public.ops_city_resolution_exempt e where e.object_name = o.name);

  -- ── limb 2: behavioural, restricted to rows the OVERLAY actually resolved ────────────────────
  with amb as (
    select l.source_table, l.listing_id, l.city_ar, l.region_ar,
           (select min(cc.city_id)
              from public.loc_catalog_city cc
              join public.loc_catalog_region cr on cr.region_id = cc.region_id
             where cc.city_norm = public.normalize_ar(l.city_ar)
               and cr.region_ar = l.region_ar) as region_city_id
      from public.listings_arabic_locations l
     where l.matched and l.city_ar is not null and l.region_ar is not null
       and (select count(distinct cc.city_id) from public.loc_catalog_city cc
             where cc.city_norm = public.normalize_ar(l.city_ar)) > 1
       and (select count(distinct cc.city_id)
              from public.loc_catalog_city cc
              join public.loc_catalog_region cr on cr.region_id = cc.region_id
             where cc.city_norm = public.normalize_ar(l.city_ar)
               and cr.region_ar = l.region_ar) = 1
  )
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
           'source_table', a.source_table, 'listing_id', a.listing_id,
           'overlay_city_ar', a.city_ar, 'published_region', a.region_ar,
           'expected_city_id', a.region_city_id, 'served_city_id', s.city_id,
           'source_method', v.source_method)), '[]'::jsonb)
    into behav_n, behav_sample
  from amb a
  join public.search_listings_ar s
    on s.source_table = a.source_table and s.listing_id = a.listing_id
  join public.listing_native_location_v2 v
    on v.source_table = a.source_table and v.listing_id = a.listing_id
  where s.city_id is not null
    and s.city_id is distinct from a.region_city_id
    -- ONLY where the overlay is the path that supplied the city. A platform's own parser or native
    -- scraper outranks the overlay by design, and disagreeing with it is not a defect.
    and v.source_method in ('lal_live_overlay', 'lal_region_scoped_overlay');

  if struct_n > 0 or behav_n > 0 then
    n := public.mon_raise('P1', 'city_resolution_ignores_region', 'all', 'city_resolution_ignores_region',
      jsonb_build_object(
        'objects_without_region_scoping', struct_n,
        'objects', structural,
        'overlay_resolved_listings_off_region', behav_n,
        'sample', behav_sample,
        'invariant', 'If the source publishes a region, resolve the city WITHIN that region. Never '
                     'require the city name to be globally unique. If it is still ambiguous inside '
                     'the published region, return UNKNOWN rather than guessing.',
        'why', 'Saudi place names repeat across regions legitimately - «الباحة» exists in منطقة الباحة '
               'and منطقة حائل, «القويعية» in four regions, «الدرعية» twice inside منطقة الرياض alone. '
               'Run #29 found the global-uniqueness rule in three implementations at once; nine live '
               'listings were unreachable by every Filter combination as a result.',
        'do_not', 'Do NOT satisfy this by loosening the unambiguity test, and do NOT widen the '
                  'behavioural limb past source_method - listings_arabic_locations is a FALLBACK, so a '
                  'platform parser or native scraper disagreeing with it is correct precedence, not a '
                  'defect. That mistake read 1,219 false positives on this detector''s first run.'));
  else
    perform public.mon_resolve_key('city_resolution_ignores_region', 'city_resolution_ignores_region');
  end if;

  return n;
end
$function$;
