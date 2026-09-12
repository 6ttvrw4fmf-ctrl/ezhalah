-- Arabic-native shadow columns on remal's raw tables (same pattern as amaall/azdad/abwbna/alobid/
-- bahadhabab) — scrapers/remal/run.py (2026-09-11) now writes city_ar/district_ar/city_id/region_id
-- directly: city_ar/city_id/region_id via the shared to_catalog() helper, district_ar via
-- find_district_in_text()'s catalog-gated recognition of the site's own title/content text (this
-- source has no district taxonomy at all — see the scraper's own module docstring). These columns
-- exist so a following migration can wire remal into listing_native_location_v1, the resolver every
-- exact-district search actually reads (the same gap amaall had until today).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['remal_residential_listings','remal_commercial_listings'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_ar text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS district_ar text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_id integer', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS region_id integer', t);
  END LOOP;
END $$;
