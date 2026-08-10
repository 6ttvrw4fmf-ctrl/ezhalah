-- deed_location_text: finish it properly — column, extraction, storage.
--
-- Registered and mapped yesterday but never stored, which is a half-done field: the registry claims
-- Ezhalah knows about it while the data sits unread in jsonb. Two platforms publish the same concept:
--     sanadak  locationAsPerDeed      1,006 listings
--     aqarcity deed_location_text       338 of 347
--
-- It is the TITLE DEED's own wording describing the property and its boundaries
-- ("...محاطة بسور من جميع الجهات..."). Deliberately backend-only:
--   • it is free prose, so it can never be a filter predicate
--   • it must NEVER be parsed into district / street_address / coordinates — those are different
--     facts with their own fields, and mining a legal description for them is exactly the
--     "infer one field from another" failure the barrier exists to stop
--
-- Nullable, no default (Safety Barrier in DDL). Appending a column at the END of a view is legal for
-- CREATE OR REPLACE VIEW, so no DROP CASCADE and nothing downstream needs changing.
alter table public.search_listings_ar add column if not exists deed_location_text text;

comment on column public.search_listings_ar.deed_location_text is
  'The title deed''s own description of the property and its boundaries. Backend-only prose for the '
  'listing detail - NEVER a filter, and never to be parsed into district/street/coordinates.';

do $$
declare def text; n int;
  -- per-branch expression, anchored on each branch''s FROM clause so a replacement cannot land in
  -- another platform''s branch
  pairs text[][] := array[
    array['aqar_residential_listings a',      'NULL::text'],
    array['wasalt_residential_listings w',    'NULL::text'],
    array['sanadak_residential_listings s',   'NULLIF(btrim(COALESCE((s.source_capture ->> ''locationAsPerDeed''::text), ''''::text)), ''''::text)'],
    array['satel_residential_listings t',     'NULL::text'],
    array['aqarcity_residential_listings c',  'NULLIF(btrim(COALESCE((c.additional_info ->> ''deed_location_text''::text), ''''::text)), ''''::text)'],
    array['dealapp_residential_listings d',   'NULL::text']
  ];
  i int;
begin
  select pg_get_viewdef('public.listing_rich_attrs'::regclass, true) into def;

  for i in 1 .. array_length(pairs, 1) loop
    def := regexp_replace(def,
      '(AS postal_code\s*FROM ' || replace(pairs[i][1], ' ', '\s+') || ')',
      'AS postal_code,' || E'\n    ' || pairs[i][2] || ' AS deed_location_text' || E'\n   FROM ' || pairs[i][1]);
  end loop;

  n := (select count(*) from regexp_matches(def, 'AS deed_location_text', 'g'));
  if n <> 6 then
    raise exception 'deed_location_text added to % branches (expected 6) - view shape changed, refusing to apply a partial column', n;
  end if;

  execute 'create or replace view public.listing_rich_attrs as ' || def;
end $$;
