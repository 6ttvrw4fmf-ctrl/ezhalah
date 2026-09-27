-- Wave 2: four platforms onboarded in one pass, 2026-09-26 — their listing tables. Nothing here is
-- visible to users on its own; the companion migrations wire the tables into search.
--
--   ibaax (IBX)  remaxsa (RMX)  qmra (QMR)  alajlan (ALJ)
--
-- Same shape as the ten (20260925080640), the thirty-five (20260924170534) and abaad
-- (20260925011243): clone the canonical aqar_residential_listings column set INCLUDING ALL
-- (defaults, the UNIQUE (ad_number) key the scrapers upsert on, checks, indexes), enable RLS, add the
-- public-read policy, add the four location columns the aqar template does not carry, re-create the
-- three fleet triggers LIKE does not copy, and re-cut the PDPL column grant.
--
-- Every one of the four writes through db._wasalt_batch onto this same column set. Their row
-- literals were AST-read before this migration was written — scrapers/common/tests/
-- test_scraper_rows_only_use_real_columns.py, NOT_YET_ONBOARDED, which runs in CI and passed 67
-- checks over all four — so every key is inside the template + city_ar/district_ar/city_id/region_id.
--
-- BOTH tables are created for every platform even where a scraper writes only one of them (remaxsa
-- has 0 live Rent rows today, qmra has none), because the fleet's allowlists, RPCs and verifiers
-- enumerate two per platform.
--
-- CREATE TABLE takes no lock on anything that already exists and the four names are new (verified: 0
-- of the 8 exist), so this is safe outside the :05-:15 DDL window. The view and matview arms, which
-- do take ACCESS EXCLUSIVE on objects the :22 cron reads, are separate migrations.
DO $$
DECLARE p text; t text; tbl text; cols text;
BEGIN
  FOREACH p IN ARRAY ARRAY['ibaax','remaxsa','qmra','alajlan'] LOOP
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
DECLARE p text; t text; tbl text; missing text := '';
BEGIN
  FOREACH p IN ARRAY ARRAY['ibaax','remaxsa','qmra','alajlan'] LOOP
    FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
      tbl := p || '_' || t || '_listings';
      IF to_regclass('public.' || tbl) IS NULL THEN
        missing := missing || tbl || ' ';
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
  IF missing <> '' THEN
    RAISE EXCEPTION 'tables not created: %', missing;
  END IF;
  RAISE NOTICE 'all 8 tables present: location columns, UNIQUE (ad_number), fleet triggers, PDPL column grant';
END $verify$;
