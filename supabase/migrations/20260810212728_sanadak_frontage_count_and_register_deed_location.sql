-- Owner caught two gaps in the sanadak mapping, 2026-08-11.
--
-- 1. FRONTAGE COUNT. sanadak's `propertyFacingDirection` carries the SAME two concepts as wasalt's
--    `propertyFacade`, and I had only handled wasalt:
--        989 real bearings (شرق 290, شمال 207, جنوب 195, غرب 162, + 135 diagonals)
--        309 «لايوجد»      -> correctly NULL; the source is saying "none"
--         20 «ثلاثة شوارع» / «اربعة شوارع» -> a FRONTAGE COUNT, not a bearing
--    canon_direction_ar() already refused to turn those 20 into a direction — the barrier worked —
--    but they were dropped rather than landing in frontage_count. One source key, two canonical
--    fields, exactly as af_field_registry.concept_note documents for wasalt.
--
-- 2. DEED LOCATION. `locationAsPerDeed` is on 1,006 sanadak listings — the deed's own description of
--    the property and its boundaries ("...محاطة بسور من جميع الجهات..."). aqarcity publishes the same
--    concept as `deed_location_text`. Registering it as a canonical field (backend-only, prose, not a
--    filter) so the mapping can reference it — the af_platform_mapping FK refused the mapping until
--    the field existed, which is the registry contract working exactly as intended.
insert into public.af_field_registry
  (canonical_key, label_ar, category, datatype, ui_exposed, ui_group, not_exposed_reason, concept_note)
values
  ('deed_location_text','وصف الموقع حسب الصك','legal','text', false, null,
   'free prose from the title deed - belongs on the listing detail, never a filter',
   'The DEED''s description of the property and its boundaries. NOT the district, NOT the street '
   'address, NOT coordinates - it is the legal document''s own wording and must never be parsed into '
   'a location field. sanadak locationAsPerDeed (1,006) and aqarcity deed_location_text (338).')
on conflict (canonical_key) do nothing;

do $$
declare def text; n int;
begin
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;

  def := regexp_replace(def,
    '(numberMenGuestRooms[\s\S]{0,250}NULL::smallint AS total_floors,\s*)NULL::smallint AS frontage_count',
    E'\\1CASE (s.source_capture ->> ''propertyFacingDirection''::text)\n'
    || E'        WHEN ''ثلاثة شوارع''::text THEN (3)::smallint\n'
    || E'        WHEN ''اربعة شوارع''::text THEN (4)::smallint\n'
    || E'        WHEN ''أربعة شوارع''::text THEN (4)::smallint\n'
    || E'        ELSE NULL::smallint\n'
    || E'    END AS frontage_count');

  n := (select count(*) from regexp_matches(def, 'WHEN ''ثلاثة شوارع''::text THEN \(3\)::smallint', 'g'));
  if n <> 1 then
    raise exception 'sanadak frontage anchor matched % times (expected 1) - view shape changed, refusing to guess', n;
  end if;

  execute 'create or replace view public.listing_rich_attrs as ' || def;
end $$;

insert into public.af_platform_mapping (platform, canonical_key, source_key, source_location, verified_at, notes)
values
  ('sanadak','frontage_count','propertyFacingDirection','source_capture', now(),
   'SAME key as direction_ar, DIFFERENT concept: 20 rows say «ثلاثة/اربعة شوارع» (how many streets the '
   'property faces). canon_direction_ar() returns NULL for these, so a frontage count can never leak '
   'into direction, and a bearing can never leak into frontage_count.'),
  ('sanadak','deed_location_text','locationAsPerDeed','not_captured', now(),
   '1,006 listings publish it. Registered as a canonical field; still needs a column on '
   'search_listings_ar plus a rich-view branch before it can be stored.'),
  ('aqarcity','deed_location_text','deed_location_text','additional_info', now(),
   '338 of 347 publish it - already captured in additional_info, not yet promoted to a column.')
on conflict (platform, canonical_key, source_key) do nothing;
