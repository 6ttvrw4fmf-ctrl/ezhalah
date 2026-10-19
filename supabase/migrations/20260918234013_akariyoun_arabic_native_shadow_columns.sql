-- Arabic-native shadow columns on akariyoun's raw tables (same pattern as remal 20260911213753,
-- amaall, azdad, abwbna, alobid, bahadhabab) — scrapers/akariyoun/run.py writes
-- city_ar/district_ar/city_id/region_id directly: city_ar/city_id/region_id via the shared
-- to_catalog() helper, district_ar via find_district_in_text() gated on the resolved city, so the
-- site's own district wording is kept only when the catalog recognises it for that city (an
-- unrecognised district stays NULL — SOURCE IS TRUTH, unknown is never a guess). `neighborhood`
-- separately keeps the source's own text for the card.
--
-- These columns exist so the following migration can wire akariyoun into
-- listing_native_location_v1, the resolver every exact-district search actually reads — launch
-- checklist box 3. Without them the platform is reachable by city at best.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['akariyoun_residential_listings','akariyoun_commercial_listings'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_ar text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS district_ar text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_id integer', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS region_id integer', t);
  END LOOP;
END $$;