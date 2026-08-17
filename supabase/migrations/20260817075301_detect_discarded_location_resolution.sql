-- Data Integrity run #26 (2026-08-17). Barrier for the bug class fixed by
-- v2_city_falls_back_to_matched_arabic_resolution (same run).
--
-- THE CLASS: Ezhalah computes a confident, unambiguous canonical city for a listing, records it in
-- listings_arabic_locations with matched=true, and the search pipeline then DISCARDS it -- leaving
-- city_id NULL, production_ready=false, and the listing unreachable by every Filter combination.
-- Found live on 2026-08-17: 39 listings (wasalt 37, alhoshan 2, sanadak 1... 37+1+1) invisible to
-- users while their own resolution sat in the database. Root cause was precedence-by-source in
-- listing_native_location_v1.best: a native row that resolved to NOTHING outranked a legacy row
-- that resolved to a real city.
--
-- Why this needs a barrier and not just the fix: nothing anywhere measured "we resolved it and
-- then threw the answer away". Count-parity checks were all GREEN throughout -- the rows were
-- present in search_listings_ar, just permanently unreachable -- which is exactly the shape §23
-- warns about, a mechanism that fails without ever failing loudly.
--
-- The unambiguity gate (count(DISTINCT city_id) = 1) is deliberate and matches the fix: a name
-- that maps to several catalog cities must stay NULL (§6 "Never guess"), so those rows are NOT
-- counted as leaks here. Anything this detector reports is a resolution we could have used and
-- didn't. Measured cost: ~11 ms.

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
          and (select count(distinct cc.city_id) from public.loc_catalog_city cc
                where cc.city_norm = public.normalize_ar(l.city_ar)) = 1);

  if coalesce(cnt, 0) > 0 then
    select jsonb_agg(x) into sample from (
      select s.source_table, s.listing_id, s.platform, s.city_ar as search_city_ar,
             (select l.city_ar from public.listings_arabic_locations l
               where l.source_table = s.source_table and l.listing_id = s.listing_id) as resolved_city_ar
        from public.search_listings_ar s
       where s.city_id is null
         and exists (
           select 1 from public.listings_arabic_locations l
            where l.source_table = s.source_table
              and l.listing_id  = s.listing_id
              and l.matched and l.city_ar is not null
              and (select count(distinct cc.city_id) from public.loc_catalog_city cc
                    where cc.city_norm = public.normalize_ar(l.city_ar)) = 1)
       order by s.source_table, s.listing_id limit 20) x;

    n := public.mon_raise('P1', 'discarded_location_resolution', 'all', 'discarded_location_resolution',
      jsonb_build_object(
        'count', cnt,
        'sample', sample,
        'why', 'These listings have a matched=true resolution in listings_arabic_locations whose city_ar maps to EXACTLY ONE canonical catalog city, yet search_listings_ar.city_id is NULL - so they are production_ready=false and NO Filter combination can return them. Ezhalah computed the answer and discarded it. This is NOT a source limitation: the resolution already exists in our own tables. Check the fallback chain in listing_native_location_v2 (COALESCE v1.city_id -> uali -> ulg -> uc) and the precedence in listing_native_location_v1.best, which must never let a native row that resolves to NULL outrank a legacy row that resolves to a city.',
        'do_not', 'Do NOT fix this by writing a city onto the listing table, and do NOT relax the unambiguity gate. Ambiguous names are excluded here on purpose and must stay NULL.'));
  else
    perform public.mon_resolve_key('discarded_location_resolution', 'discarded_location_resolution');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_discarded_location_resolution() is
  'Run #26 (2026-08-17): fires when a listing has an unambiguous matched resolution in listings_arabic_locations but search_listings_ar.city_id is still NULL - i.e. Ezhalah resolved the city and the pipeline threw it away, making the listing unreachable by every Filter. Baseline at creation: 0 (39 such rows had just been recovered). Ambiguous names are deliberately excluded and must remain NULL.';

-- Roster wiring by GUARDED NEEDLE-EDIT (DATA_INTEGRITY 22.2): read the live body, assert the
-- anchor, splice. Never rebuild mon_run_all_detectors() from an assumed version.
--
-- NOTE, learned the hard way in this very migration: operate on the RAW pg_get_functiondef text.
-- A function body preserves its "--" line comments, so collapsing newlines to spaces (the trick
-- that is safe for pg_get_viewdef, which stores no comments) turns the remainder of the body into
-- one comment and truncates the $function$ terminator. The first attempt failed exactly that way.
do $roster$
declare
  v_def text;
  v_new text;
  n_anchor int;
begin
  v_def := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);

  if position('mon_detect_discarded_location_resolution' in v_def) > 0 then
    raise notice 'already rostered; nothing to do';
    return;
  end if;

  n_anchor := (length(v_def) - length(replace(v_def, '''mon_detect_silent_scraper_death'',', '')))
              / length('''mon_detect_silent_scraper_death'',');
  if n_anchor <> 1 then
    raise exception 'mon_run_all_detectors roster anchor found % times, expected exactly 1 - refusing to splice', n_anchor;
  end if;

  v_new := replace(v_def,
    '''mon_detect_silent_scraper_death'',',
    '''mon_detect_discarded_location_resolution'',' || chr(10) || '    ''mon_detect_silent_scraper_death'',');

  execute v_new;
end
$roster$;

-- Prove the wiring took, in the same migration: a detector nothing calls is decoration.
do $assert$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_discarded_location_resolution' in v_def) = 0 then
    raise exception 'roster splice did not take - mon_detect_discarded_location_resolution is not reachable';
  end if;
  if position('mon_detect_silent_scraper_death' in v_def) = 0
     or position('mon_detect_orphaned_search_row' in v_def) = 0
     or position('mon_detect_price_size_contamination' in v_def) = 0
     or position('mon_detect_orphaned_detectors' in v_def) = 0 then
    raise exception 'roster lost pre-existing entries during the splice - aborting';
  end if;
end
$assert$;
