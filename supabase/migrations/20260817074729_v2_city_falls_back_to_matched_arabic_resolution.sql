-- Data Integrity run #26 (2026-08-17).
--
-- DEFECT: listing_native_location_v1.best picks the NATIVE row by source precedence alone
-- (priority 1 beats priority 2), even when the native row resolves to NO city at all. When a
-- platform publishes a native Arabic city string the canonical catalog does not carry --
-- e.g. wasalt «مدينه الجبيل الصناعيه» -- v1.city_id is NULL, v2's alias fallback (uali) finds
-- nothing, and the listing is production_ready=false: invisible to every user.
--
-- Meanwhile listings_arabic_locations ALREADY holds a matched=true resolution for that very
-- listing, derived from the SAME platform's own English city field (wasalt publishes
-- city="Jubail" -> «الجبيل», loc_city_map + the region-scoped catalog lookup). Ezhalah computed
-- a confident match and then discarded it. AGENTS/DATA_INTEGRITY §6: "Confident match ->
-- canonical ID"; §2: the location resolver must not incorrectly block a valid listing.
--
-- FIX: one more branch on v2's EXISTING COALESCE fallback chain, exactly parallel to the alias
-- branch already there, and reached ONLY when both v1.city_id and the alias lookup are NULL --
-- so no row that resolves today can change. Gated to an UNAMBIGUOUS catalog match
-- (HAVING count(DISTINCT cc2.city_id) = 1, the same idiom the udid district lateral uses), so
-- an ambiguous name still resolves to NULL and is never guessed (§6: "Never guess").
-- Keyed on (source_table, listing_id) -- stricter than the (platform, listing_id) idiom used
-- elsewhere in v1, so a residential/commercial id collision cannot cross-assign a city.
--
-- No listing data is modified. The native source text stays in the platform table untouched and
-- still populates v2.city_ar; only the canonical city_id/region_id are filled in from Ezhalah's
-- own already-recorded match.
--
-- Applied as a GUARDED NEEDLE-EDIT (DATA_INTEGRITY §22.2): the live definition is read, every
-- anchor's occurrence count is asserted, and only then is the text spliced. The body is never
-- rebuilt from an assumed version.

create table if not exists ops_view_definition_backup (
  id            bigserial primary key,
  view_name     text        not null,
  captured_at   timestamptz not null default now(),
  reason        text,
  definition    text        not null
);

do $mig$
declare
  v_def text;
  v_new text;
  v_lateral text;
  n_city int; n_region int; n_region_ar int; n_uali int; n_from int;
begin
  v_def := regexp_replace(pg_get_viewdef('public.listing_native_location_v2'::regclass), '\s+', ' ', 'g');

  n_city      := (length(v_def) - length(replace(v_def,'COALESCE(v1.city_id, uali.city_id, uc.city_id)','')))
                 / length('COALESCE(v1.city_id, uali.city_id, uc.city_id)');
  n_region    := (length(v_def) - length(replace(v_def,'COALESCE(v1.region_id, uac.region_id, uc.region_id)','')))
                 / length('COALESCE(v1.region_id, uac.region_id, uc.region_id)');
  n_region_ar := (length(v_def) - length(replace(v_def,'COALESCE(v1.region_ar, uar.region_ar, ur.region_ar)','')))
                 / length('COALESCE(v1.region_ar, uar.region_ar, ur.region_ar)');
  n_uali      := (length(v_def) - length(replace(v_def,'LIMIT 1) uali ON (true))','')))
                 / length('LIMIT 1) uali ON (true))');
  n_from      := (length(v_def) - length(replace(v_def,'FROM ((((((((((listing_native_location_v1 v1','')))
                 / length('FROM ((((((((((listing_native_location_v1 v1');

  if n_city <> 2 or n_region <> 2 or n_region_ar <> 1 or n_uali <> 1 or n_from <> 1 then
    raise exception 'listing_native_location_v2 does not have the expected shape (city=%, region=%, region_ar=%, uali=%, from=%) - refusing to splice a definition I did not read',
      n_city, n_region, n_region_ar, n_uali, n_from;
  end if;

  insert into ops_view_definition_backup(view_name, reason, definition)
  values ('listing_native_location_v2',
          'run26: before adding the matched-arabic-resolution city fallback',
          pg_get_viewdef('public.listing_native_location_v2'::regclass));

  v_lateral :=
    ' LEFT JOIN LATERAL ( SELECT max(cc2.city_id) AS city_id'
 || ' FROM (listings_arabic_locations lal2'
 || ' JOIN loc_catalog_city cc2 ON ((cc2.city_norm = normalize_ar(lal2.city_ar))))'
 || ' WHERE ((v1.city_id IS NULL) AND (uali.city_id IS NULL) AND lal2.matched'
 || ' AND (lal2.city_ar IS NOT NULL) AND (lal2.source_table = v1.source_table)'
 || ' AND (lal2.listing_id = v1.listing_id))'
 || ' HAVING (count(DISTINCT cc2.city_id) = 1)) ulg ON (true))'
 || ' LEFT JOIN loc_catalog_city ulgc ON ((ulgc.city_id = ulg.city_id)))'
 || ' LEFT JOIN loc_catalog_region ulgr ON ((ulgr.region_id = ulgc.region_id)))';

  v_new := replace(v_def,
      'FROM ((((((((((listing_native_location_v1 v1',
      'FROM (((((((((((((listing_native_location_v1 v1');

  v_new := replace(v_new, 'LIMIT 1) uali ON (true))', 'LIMIT 1) uali ON (true))' || v_lateral);

  v_new := replace(v_new,
      'COALESCE(v1.city_id, uali.city_id, uc.city_id)',
      'COALESCE(v1.city_id, uali.city_id, ulg.city_id, uc.city_id)');

  v_new := replace(v_new,
      'COALESCE(v1.region_id, uac.region_id, uc.region_id)',
      'COALESCE(v1.region_id, uac.region_id, ulgc.region_id, uc.region_id)');

  v_new := replace(v_new,
      'COALESCE(v1.region_ar, uar.region_ar, ur.region_ar)',
      'COALESCE(v1.region_ar, uar.region_ar, ulgr.region_ar, ur.region_ar)');

  execute 'CREATE OR REPLACE VIEW public.listing_native_location_v2 AS ' || v_new;
end
$mig$;

comment on table ops_view_definition_backup is
  'Verbatim pg_get_viewdef snapshots taken immediately before an agent session splices a view definition, so a needle-edit is always revertible without reconstructing the original by hand.';
