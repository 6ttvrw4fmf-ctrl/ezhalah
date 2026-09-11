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