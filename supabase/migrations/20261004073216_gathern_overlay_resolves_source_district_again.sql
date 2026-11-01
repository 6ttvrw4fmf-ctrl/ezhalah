-- Gathern's source-published Arabic district never reached search_listings_ar for new units
-- (2026-10-04: 37 of 42 new Gathern listings had no district; 71 older ones with the same shape had one).
-- ROOT CAUSE: listing_native_location_v2's gathern_additional_info_overlay arm was fixed on 2026-09-11
-- (20260911213602) to resolve additional_info->>'district_ar' through resolve_district_ar(); later full
-- redefinitions of the view (0913 ... 0927) were built from a stale copy and put back
-- "NULL::text AS district_ar", so the fix was silently lost. This re-applies it as a needle edit on the
-- LIVE body (never a pasted copy): resolve_district_ar returns NULL when unattested, never guesses.
do $$
declare v_def text; v_new text; n1 int; n2 int; n3 int;
  a1 constant text := E'NULL::text AS district_ar,\n            COALESCE(lalc.region_ar, lalc2.region_ar, gcr2.region_ar) AS region_ar,';
  p2 constant text := '(\(g\.additional_info ->> ''resolved_region_id''::text\)::integer AS region_id)(\s+FROM gathern_residential_listings g)';
  p3 constant text := '(\(g\.additional_info ->> ''resolved_region_id''::text\)::integer AS int4)(\s+FROM gathern_commercial_listings g)';
begin
  select pg_get_viewdef('public.listing_native_location_v2'::regclass,true) into v_def;
  n1 := (length(v_def)-length(replace(v_def,a1,'')))/length(a1);
  n2 := (select count(*) from regexp_matches(v_def,p2,'g'));
  n3 := (select count(*) from regexp_matches(v_def,p3,'g'));
  if n1 <> 1 or n2 <> 1 or n3 <> 1 then
    raise exception 'REFUSED: anchors not unique (n1=%, n2=%, n3=%)', n1, n2, n3;
  end if;
  v_new := replace(v_def, a1, E'gth.district_ar AS district_ar,\n            COALESCE(lalc.region_ar, lalc2.region_ar, gcr2.region_ar) AS region_ar,');
  v_new := regexp_replace(v_new, p2, E'\\1,\n public.resolve_district_ar((g.additional_info ->> ''resolved_city_id''::text)::integer, g.additional_info ->> ''district_ar''::text) AS district_ar\\2');
  v_new := regexp_replace(v_new, p3, E'\\1,\n public.resolve_district_ar((g.additional_info ->> ''resolved_city_id''::text)::integer, g.additional_info ->> ''district_ar''::text) AS district_ar\\2');
  if v_new = v_def then raise exception 'REFUSED: no change produced'; end if;
  execute 'create or replace view public.listing_native_location_v2 as ' || v_new;
  -- check block: the live body now carries the resolver in both gathern arms
  select pg_get_viewdef('public.listing_native_location_v2'::regclass,true) into v_def;
  if (length(v_def)-length(replace(v_def,'resolve_district_ar',''))) / length('resolve_district_ar') <> 2
     or position('gth.district_ar' in v_def) = 0 then
    raise exception 'CHECK FAILED: gathern district resolver not present after edit';
  end if;
end $$;
