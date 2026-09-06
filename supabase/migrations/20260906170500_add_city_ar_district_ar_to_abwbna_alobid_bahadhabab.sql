-- Real bug caught in production (2026-09-06): abwbna, alobid and bahadhabab were all created via
-- `CREATE TABLE ... (LIKE aqar_residential_listings INCLUDING ALL)`, but their run.py — cloned from
-- aldarim's — emits `city_ar`/`district_ar` on every row, exactly as aldarim's own run.py does.
-- aldarim's OWN tables carry those two columns (added by hand at some earlier, unmigrated point —
-- confirmed live: aqar_residential_listings has neither, aldarim_residential_listings has both,
-- nullable text, no default). The aqar-derived template never got them, so this went unnoticed
-- through three separate onboardings because none of the three had actually been crawled in
-- production until today's first real dispatch, which failed immediately:
--   PGRST204 "Could not find the 'city_ar' column of 'abwbna_residential_listings' in the schema
--   cache" — a genuine missing column, not a stale PostgREST cache.
--
-- Matches aldarim_residential_listings.city_ar / .district_ar exactly: nullable text, no default.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'abwbna_residential_listings','abwbna_commercial_listings',
    'alobid_residential_listings','alobid_commercial_listings',
    'bahadhabab_residential_listings','bahadhabab_commercial_listings'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_ar text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS district_ar text', t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
