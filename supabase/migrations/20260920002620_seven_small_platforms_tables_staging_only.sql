-- Seven small platforms onboarded in one pass, 2026-09-19. STAGING ONLY: these tables are not yet
-- an arm of any search view, so nothing here is visible to users until a separate activation lands.
--
--   gudai / safera / alhumaidan   three tenant offices of ONE inblaj.net WordPress product. They
--                                 share a parser (scrapers/common/inblaj_platform.py) but each is
--                                 its own platform with its own tables, registry row and ledger.
--   aqarnajran                    wp/v2 REST; 39 of 41 posts map.
--   fahadalshahri                 WooCommerce Store API; 5 of 25 map — the rest name no city and
--                                 are skipped rather than assumed to be Jeddah.
--   compoundin                    residential compounds; the ROW GRAIN IS THE UNIT (one compound
--                                 carries up to 8 separately priced units). ~180 units.
--   wslnaa                        client-rendered; read from the app's own tRPC endpoint. ~58.
--
-- Same shape as the ksaaqar/sadiqeltajer tables (20260919061628 / 20260919062925): clone the
-- canonical aqar_residential_listings column set, enable RLS, add the public-read policy.
--
-- city_id / region_id ARE ADDED HERE, IN THE SAME MIGRATION. The aqar template does not carry them,
-- and on the last onboarding that cost a whole sweep: the scrapers resolve the catalog and send
-- both keys, PostgREST rejected the ENTIRE batch with PGRST204, and 1,809 mapped listings wrote 0
-- rows (20260919065332). One unknown key loses every row, not just that field.
DO $$
DECLARE p text; t text; tbl text;
BEGIN
  FOREACH p IN ARRAY ARRAY['gudai','safera','alhumaidan','aqarnajran','fahadalshahri',
                           'compoundin','wslnaa'] LOOP
    FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
      tbl := p || '_' || t || '_listings';
      EXECUTE format('CREATE TABLE IF NOT EXISTS %I (LIKE aqar_residential_listings INCLUDING ALL)', tbl);
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "public read" ON %I', tbl);
      EXECUTE format('CREATE POLICY "public read" ON %I FOR SELECT USING (true)', tbl);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_ar text', tbl);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS district_ar text', tbl);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_id integer', tbl);
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS region_id integer', tbl);
    END LOOP;
  END LOOP;
END $$;

DO $verify$
DECLARE p text; t text; tbl text; missing text := '';
BEGIN
  FOREACH p IN ARRAY ARRAY['gudai','safera','alhumaidan','aqarnajran','fahadalshahri',
                           'compoundin','wslnaa'] LOOP
    FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
      tbl := p || '_' || t || '_listings';
      IF to_regclass('public.' || tbl) IS NULL THEN
        missing := missing || tbl || ' ';
      ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name=tbl AND column_name='city_id') THEN
        RAISE EXCEPTION '% exists but has no city_id — the PGRST204 trap is still open', tbl;
      END IF;
    END LOOP;
  END LOOP;
  IF missing <> '' THEN
    RAISE EXCEPTION 'tables not created: %', missing;
  END IF;
  RAISE NOTICE 'all 14 tables present with city_id/region_id/city_ar/district_ar';
END $verify$;
