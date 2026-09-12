-- DEFECT (found tracing district survival scraped -> listing_native_location_v2 ->
-- search_listings_ar for gathern/wasalt/aqar/dealapp/remal/amaall, 2026-09-11).
--
-- 74 active gathern_residential_listings carry a genuine source-published district (the
-- English `neighborhood` field, plus its already-produced Arabic translation in
-- additional_info->>'district_ar', e.g. "Al Malqa Dist." / "حي الملقا") and a successfully
-- resolved city_id, yet search_listings_ar.district_ar is NULL for every one of them. They
-- ARE reachable by city (production_ready=true) but can never surface under a حي filter.
--
-- ROOT CAUSE. These 74 listings have no row at all in listing_native_location_v1 (not native,
-- not legacy-matched via listings_arabic_locations), so they are produced by v2's catch-all
-- UNION ALL branch (for source_tables absent from v1). That branch's `gathern_additional_info_
-- overlay` arm already reads additional_info->>'resolved_city_id' to resolve city_id -- but the
-- branch's single shared `district_ar` output column is hardcoded `NULL::text` for every row,
-- discarding the district sitting in that exact same additional_info blob. district_recovery
-- (the hourly gap-filler) cannot reach them either: it only ever reads FROM
-- listing_native_location_v1, and these rows have no v1 row to read.
--
-- FIX. Resolve district_ar inside the gathern_additional_info_overlay lateral using
-- resolve_district_ar(city_id, additional_info->>'district_ar') -- the SAME vetted resolver
-- district_recovery already uses for this exact gap elsewhere (attested-in-this-city lookup via
-- loc_canonical_district; returns NULL rather than inventing a value when unattested, so a
-- genuinely unparseable/unattested district still stays NULL, never guessed). Every other arm of
-- the catch-all branch (lal_live_overlay, lal_region_scoped_overlay, unresolved_catchall) is
-- untouched -- gth is NULL for their rows exactly as before.
--
-- Anchor uniqueness verified live before writing this migration (both = 1):
--   NULL::text AS district_ar,                                   (n1)
--   the gathern_additional_info_overlay LEFT JOIN LATERAL block   (n2)

do $$
declare v_def text; v_new text; a1 text; a2 text; a2new text; n1 int; n2 int;
begin
  select pg_get_viewdef(c.oid,true) into v_def from pg_class c where c.relname='listing_native_location_v2';

  a1 := 'NULL::text AS district_ar,';

  a2 := '     LEFT JOIN LATERAL ( SELECT (g.additional_info ->> ''resolved_city_id''::text)::integer AS city_id,
            (g.additional_info ->> ''resolved_region_id''::text)::integer AS region_id
           FROM gathern_residential_listings g
          WHERE a.source_table = ''gathern_residential_listings''::text AND g.id = a.listing_id AND (g.additional_info ->> ''resolved_confidence''::text) = ''city''::text
        UNION ALL
         SELECT (g.additional_info ->> ''resolved_city_id''::text)::integer AS int4,
            (g.additional_info ->> ''resolved_region_id''::text)::integer AS int4
           FROM gathern_commercial_listings g
          WHERE a.source_table = ''gathern_commercial_listings''::text AND g.id = a.listing_id AND (g.additional_info ->> ''resolved_confidence''::text) = ''city''::text) gth ON true';

  n1 := (length(v_def)-length(replace(v_def,a1,'')))/length(a1);
  n2 := (length(v_def)-length(replace(v_def,a2,'')))/length(a2);
  if n1 <> 1 or n2 <> 1 then
    raise exception 'REFUSED: anchors not unique (n1=%, n2=%)', n1, n2;
  end if;

  a2new := '     LEFT JOIN LATERAL ( SELECT (g.additional_info ->> ''resolved_city_id''::text)::integer AS city_id,
            (g.additional_info ->> ''resolved_region_id''::text)::integer AS region_id,
            public.resolve_district_ar((g.additional_info ->> ''resolved_city_id''::text)::integer, g.additional_info ->> ''district_ar''::text) AS district_ar
           FROM gathern_residential_listings g
          WHERE a.source_table = ''gathern_residential_listings''::text AND g.id = a.listing_id AND (g.additional_info ->> ''resolved_confidence''::text) = ''city''::text
        UNION ALL
         SELECT (g.additional_info ->> ''resolved_city_id''::text)::integer AS int4,
            (g.additional_info ->> ''resolved_region_id''::text)::integer AS int4,
            public.resolve_district_ar((g.additional_info ->> ''resolved_city_id''::text)::integer, g.additional_info ->> ''district_ar''::text) AS district_ar
           FROM gathern_commercial_listings g
          WHERE a.source_table = ''gathern_commercial_listings''::text AND g.id = a.listing_id AND (g.additional_info ->> ''resolved_confidence''::text) = ''city''::text) gth ON true';

  v_new := replace(v_def, a1, 'gth.district_ar AS district_ar,');
  v_new := replace(v_new, a2, a2new);

  if v_new = v_def then
    raise exception 'REFUSED: no change produced';
  end if;

  execute 'create or replace view public.listing_native_location_v2 as ' || v_new;
end $$;
