-- Data Integrity run #29 (2026-08-18), third layer of the same defect.
--
-- After resolve_english_city_overlay was fixed to accept "unique inside the region the platform
-- published", 6 of the 9 stranded listings resolved immediately — and 3 dealapp rows did not:
--
--   dealapp_residential 8480954 «الباحة»  | dealapp_commercial 8481914 «الباحة»
--   dealapp_residential 8481138 «القويعية»
--
-- They carry a matched listings_arabic_locations row with the right city AND region, and
-- listing_native_location_v2 still reported source_method='unresolved_catchall', city_id NULL.
-- Reason: these listings have no listing_native_location_v1 row, so they take v2's THIRD union
-- branch, whose only lal lateral (lalc) joins loc_catalog_city by NAME across the whole catalog and
-- then demands count(distinct city_id)=1. «الباحة» exists in منطقة الباحة and منطقة حائل, so the
-- HAVING fails and a perfectly determined city is discarded.
--
-- The v1 branch has had the region-scoped fallback for a while — its ulg2 lateral joins
-- loc_catalog_region on lal.region_ar. The catchall branch never got the equivalent. This adds it
-- as lalc2, consulted ONLY when lalc found nothing, with the identical unambiguity rule:
-- count(distinct city_id)=1 inside the region recorded on the same resolution row. Ambiguity still
-- yields NOTHING.
--
-- Edited as a guarded needle-splice of the LIVE definition (pg_get_viewdef), never a retyped body:
-- this view is the source of the search index and a hand-copy is how definitions drift.

do $$
declare
  src text; newsrc text;
  anchor_lateral constant text := ') lalc ON true';
  anchor_case    constant text := 'WHEN lalc.city_id IS NOT NULL THEN ''lal_live_overlay''::text';
  add_lateral    constant text :=
    ') lalc ON true
     LEFT JOIN LATERAL ( SELECT min(lc2.city_id) AS city_id,
            min(lc2.region_id) AS region_id,
            min(l2.city_ar) AS city_ar,
            min(cr2.region_ar) AS region_ar
           FROM listings_arabic_locations l2
             JOIN loc_catalog_region cr2 ON cr2.region_ar = l2.region_ar
             JOIN loc_catalog_city lc2 ON lc2.city_norm = normalize_ar(l2.city_ar) AND lc2.region_id = cr2.region_id
          WHERE lalc.city_id IS NULL AND l2.source_table = a.source_table AND l2.listing_id = a.listing_id
            AND l2.matched IS TRUE AND l2.city_ar IS NOT NULL AND l2.region_ar IS NOT NULL
         HAVING count(DISTINCT lc2.city_id) = 1) lalc2 ON true';
  add_case constant text :=
    'WHEN lalc.city_id IS NOT NULL THEN ''lal_live_overlay''::text
            WHEN lalc2.city_id IS NOT NULL THEN ''lal_region_scoped_overlay''::text';
  n int;
begin
  select pg_get_viewdef('public.listing_native_location_v2'::regclass, true) into src;
  if src is null then raise exception 'listing_native_location_v2 not found'; end if;
  if position('lalc2' in src) > 0 then raise notice 'already extended - no-op'; return; end if;

  -- Every anchor must appear exactly the expected number of times, or refuse to splice.
  n := (length(src) - length(replace(src, anchor_lateral, ''))) / length(anchor_lateral);
  if n <> 1 then raise exception 'lateral anchor appears % times, expected 1', n; end if;
  n := (length(src) - length(replace(src, anchor_case, ''))) / length(anchor_case);
  if n <> 1 then raise exception 'case anchor appears % times, expected 1', n; end if;
  n := (length(src) - length(replace(src, 'COALESCE(lalc.city_id, gth.city_id)', '')))
       / length('COALESCE(lalc.city_id, gth.city_id)');
  if n <> 2 then raise exception 'city_id COALESCE appears % times, expected 2 (select list + production_ready)', n; end if;
  n := (length(src) - length(replace(src, 'COALESCE(lalc.region_id, gth.region_id)', '')))
       / length('COALESCE(lalc.region_id, gth.region_id)');
  if n <> 2 then raise exception 'region_id COALESCE appears % times, expected 2', n; end if;

  newsrc := replace(src, anchor_lateral, add_lateral);
  newsrc := replace(newsrc, anchor_case, add_case);
  newsrc := replace(newsrc, 'COALESCE(lalc.city_id, gth.city_id)',    'COALESCE(lalc.city_id, lalc2.city_id, gth.city_id)');
  newsrc := replace(newsrc, 'COALESCE(lalc.region_id, gth.region_id)','COALESCE(lalc.region_id, lalc2.region_id, gth.region_id)');
  newsrc := replace(newsrc, 'COALESCE(lalc.city_ar, gcat.city_ar)',   'COALESCE(lalc.city_ar, lalc2.city_ar, gcat.city_ar)');
  newsrc := replace(newsrc, 'COALESCE(lalc.region_ar, gcr2.region_ar)','COALESCE(lalc.region_ar, lalc2.region_ar, gcr2.region_ar)');

  if position('lalc2' in newsrc) = 0 then raise exception 'splice produced no lalc2 - refusing'; end if;

  execute 'create or replace view public.listing_native_location_v2 as ' || newsrc;
end $$;

-- ── Prove the change moved EXACTLY the intended rows and nothing else ──────────────────────────
do $$
declare gained int; lost int; changed int;
begin
  select count(*) into gained
    from public.listing_native_location_v2 v
    join public.ops_v2_snapshot_run29 s
      on s.source_table = v.source_table and s.listing_id = v.listing_id
   where s.city_id is null and v.city_id is not null;

  select count(*) into lost
    from public.listing_native_location_v2 v
    join public.ops_v2_snapshot_run29 s
      on s.source_table = v.source_table and s.listing_id = v.listing_id
   where s.city_id is not null and v.city_id is null;

  select count(*) into changed
    from public.listing_native_location_v2 v
    join public.ops_v2_snapshot_run29 s
      on s.source_table = v.source_table and s.listing_id = v.listing_id
   where s.city_id is not null and v.city_id is not null and s.city_id <> v.city_id;

  if lost <> 0 then raise exception 'REGRESSION: % rows LOST their city', lost; end if;
  if changed <> 0 then raise exception 'REGRESSION: % rows had their city CHANGED', changed; end if;
  if gained <> 3 then raise exception 'expected exactly the 3 stranded dealapp rows to gain a city, got %', gained; end if;

  if not exists (select 1 from public.listing_native_location_v2
                  where source_table='dealapp_residential_listings' and listing_id=8481138
                    and city_id = 880 and source_method='lal_region_scoped_overlay') then
    raise exception 'control dealapp 8481138 did not resolve to city_id 880 via the new branch';
  end if;
end $$;

drop table if exists public.ops_v2_snapshot_run29;
