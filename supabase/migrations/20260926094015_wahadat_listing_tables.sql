-- Wahadat (وحدات, WHD) — its two listing tables. Wave 3, 2026-09-26. Not visible to users on its
-- own; companion migrations wire it into search.
--
-- Identical shape and guards to the wave-2 four (20260926042334): clone aqar_residential_listings
-- INCLUDING ALL (defaults, the UNIQUE (ad_number) the scraper upserts on, checks, indexes), enable
-- RLS + public read, add the four location columns the aqar template lacks, re-create the three
-- fleet triggers LIKE does not copy, and re-cut the PDPL column grant so anon can never read
-- source_capture.
--
-- BOTH tables are created although the measured sample is 100% residential (90/90 rows over 14
-- projects): the fleet's allowlists, RPCs and verifiers enumerate two tables per platform, and a
-- single commercial unit later must not need a migration.
--
-- CREATE TABLE takes no lock on anything that exists and both names are new, so this is safe
-- outside the :05–:15 DDL window. The view/matview arms are separate migrations.
DO $$
DECLARE t text; tbl text; cols text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
    tbl := 'wahadat_' || t || '_listings';
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
END $$;

DO $verify$
DECLARE t text; tbl text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
    tbl := 'wahadat_' || t || '_listings';
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE EXCEPTION 'table not created: %', tbl;
    ELSIF (SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = tbl
              AND column_name IN ('city_ar','district_ar','city_id','region_id')) <> 4 THEN
      RAISE EXCEPTION '% exists without all of city_ar/district_ar/city_id/region_id — the PGRST204 trap is still open', tbl;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conrelid = ('public.' || tbl)::regclass AND contype = 'u'
                         AND pg_get_constraintdef(oid) = 'UNIQUE (ad_number)') THEN
      RAISE EXCEPTION '% has no UNIQUE (ad_number) — the scraper upserts on_conflict=ad_number', tbl;
    ELSIF (SELECT count(*) FROM pg_trigger WHERE tgrelid = ('public.' || tbl)::regclass AND NOT tgisinternal
             AND tgname IN ('trg_set_deactivated_at','trg_archive_hard_delete','zz_redact_pii')) <> 3 THEN
      RAISE EXCEPTION '% is missing a fleet trigger (deactivated_at / hard-delete archive / PII)', tbl;
    ELSIF has_column_privilege('anon', 'public.' || tbl, 'source_capture', 'SELECT')
       OR NOT has_column_privilege('anon', 'public.' || tbl, 'ad_number', 'SELECT') THEN
      RAISE EXCEPTION '% column grant is wrong: anon must read ad_number and must NOT read source_capture', tbl;
    END IF;
  END LOOP;
  RAISE NOTICE 'wahadat: both tables present with location columns, UNIQUE (ad_number), fleet triggers, PDPL column grant';
END $verify$;
