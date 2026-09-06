-- Continuation of 20260906170500 (that migration fixed city_ar/district_ar but the FIRST live
-- crawl dispatch after it still failed — PGRST204 on `city_id` this time). Diffed the full column
-- set of aldarim_residential_listings/aldarim_commercial_listings against the aqar-derived template
-- these three clones were built from: aldarim carries FOUR extra columns beyond the template, not
-- two — city_ar/district_ar (text) AND city_id/region_id (integer), all nullable, no default.
-- abwbna/alobid/bahadhabab's run.py (correctly cloned from aldarim's) emit all four on every row.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'abwbna_residential_listings','abwbna_commercial_listings',
    'alobid_residential_listings','alobid_commercial_listings',
    'bahadhabab_residential_listings','bahadhabab_commercial_listings'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_id integer', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS region_id integer', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
