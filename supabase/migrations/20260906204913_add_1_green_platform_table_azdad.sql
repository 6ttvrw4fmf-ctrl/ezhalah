DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I (LIKE aqar_residential_listings INCLUDING ALL)',
      'azdad_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_ar text', 'azdad_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS district_ar text', 'azdad_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_id integer', 'azdad_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS region_id integer', 'azdad_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', 'azdad_'||t||'_listings');
    EXECUTE format('DROP POLICY IF EXISTS "public read" ON %I', 'azdad_'||t||'_listings');
    EXECUTE format('CREATE POLICY "public read" ON %I FOR SELECT USING (true)', 'azdad_'||t||'_listings');
  END LOOP;
END $$;