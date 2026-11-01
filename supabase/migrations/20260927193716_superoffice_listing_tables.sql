-- SuperOffice (2026-09-27, owner-approved) — the listing tables of superoffice. Not visible to
-- users on their own; companion migrations wire them in. Identical shape and guards to batch 6's
-- 20260927034329: clone aqar_residential_listings INCLUDING ALL, RLS + public read, the four location
-- columns, the three fleet triggers, and the PDPL column grant (anon can never read source_capture).
-- CREATE TABLE takes no lock on anything that exists and every name is new.
DO $$
DECLARE p text; t text; tbl text; cols text;
BEGIN
  FOREACH p IN ARRAY ARRAY['superoffice'] LOOP
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
      EXECUTE format('DROP TRIGGER IF EXISTS trg_set_deactivated_at ON %I', tbl);
      EXECUTE format('CREATE TRIGGER trg_set_deactivated_at BEFORE UPDATE ON %I FOR EACH ROW '
                     'WHEN (old.active IS DISTINCT FROM new.active) EXECUTE FUNCTION set_deactivated_at()', tbl);
      EXECUTE format('DROP TRIGGER IF EXISTS trg_archive_hard_delete ON %I', tbl);
      EXECUTE format('CREATE TRIGGER trg_archive_hard_delete AFTER DELETE ON %I FOR EACH ROW '
                     'EXECUTE FUNCTION tg_archive_hard_deleted_listing()', tbl);
      EXECUTE format('DROP TRIGGER IF EXISTS zz_redact_pii ON %I', tbl);
      EXECUTE format('CREATE TRIGGER zz_redact_pii BEFORE INSERT OR UPDATE ON %I FOR EACH ROW '
                     'EXECUTE FUNCTION trg_redact_user_visible_pii()', tbl);
      SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = tbl AND column_name <> 'source_capture';
      EXECUTE format('REVOKE SELECT ON public.%I FROM anon, authenticated', tbl);
      EXECUTE format('GRANT SELECT (%s) ON public.%I TO anon, authenticated', cols, tbl);
    END LOOP;
  END LOOP;
END $$;

DO $verify$
DECLARE p text; t text; tbl text;
BEGIN
  FOREACH p IN ARRAY ARRAY['superoffice'] LOOP
    FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
      tbl := p || '_' || t || '_listings';
      IF to_regclass('public.' || tbl) IS NULL THEN
        RAISE EXCEPTION 'table not created: %', tbl;
      ELSIF (SELECT count(*) FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = tbl
                AND column_name IN ('city_ar','district_ar','city_id','region_id')) <> 4 THEN
        RAISE EXCEPTION '% exists without all of city_ar/district_ar/city_id/region_id — the PGRST204 trap is still open', tbl;
      ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint
                         WHERE conrelid = ('public.' || tbl)::regclass AND contype = 'u'
                           AND pg_get_constraintdef(oid) = 'UNIQUE (ad_number)') THEN
        RAISE EXCEPTION '% has no UNIQUE (ad_number) — the scrapers upsert on_conflict=ad_number', tbl;
      ELSIF (SELECT count(*) FROM pg_trigger WHERE tgrelid = ('public.' || tbl)::regclass AND NOT tgisinternal
               AND tgname IN ('trg_set_deactivated_at','trg_archive_hard_delete','zz_redact_pii')) <> 3 THEN
        RAISE EXCEPTION '% is missing a fleet trigger (deactivated_at / hard-delete archive / PII)', tbl;
      ELSIF has_column_privilege('anon', 'public.' || tbl, 'source_capture', 'SELECT')
         OR NOT has_column_privilege('anon', 'public.' || tbl, 'ad_number', 'SELECT') THEN
        RAISE EXCEPTION '% column grant is wrong: anon must read ad_number and must NOT read source_capture', tbl;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'superoffice: both tables present with location columns, UNIQUE (ad_number), fleet triggers, PDPL column grant';
END $verify$;