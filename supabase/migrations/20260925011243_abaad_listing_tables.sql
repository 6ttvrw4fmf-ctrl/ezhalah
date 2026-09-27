-- أبعاد (abaad, prefix ABD, app.abaadapp.sa) — its two listing tables. Nothing is visible to users
-- from this migration alone; the companion wiring migrations put it into search and the Advanced
-- Filter. Scraper: scrapers/abaad/run.py (PR #4091), a clean public JSON API
-- (/api/v1/estate/get-estate/all, total_size ~400, no auth, no proxy).
--
-- Same shape as the thirty-five-platform tables (20260924170534) and the eleven before them: clone
-- the canonical aqar_residential_listings column set INCLUDING ALL (defaults, the UNIQUE(ad_number)
-- key the scrapers upsert on, checks, indexes), enable RLS, add the public-read policy, add the
-- four location columns the aqar template does not carry, re-attach the three fleet triggers that
-- LIKE ... INCLUDING ALL does not copy, and re-grant the PDPL column list (anon/authenticated get
-- every column EXCEPT source_capture).
--
-- city_id / region_id are added HERE, in the same migration: one unknown key makes PostgREST reject
-- the ENTIRE batch with PGRST204 (20260919065332 lost 1,809 mapped rows that way).
--
-- The commercial twin is created even though abaad's mapped catalogue is mostly residential,
-- because the fleet's allowlists, RPCs and verifiers are table-grained and enumerate both.
--
-- NOTE ON THE PDPL CHECK BELOW. A first draft of this migration asserted that source_capture does
-- not appear in information_schema.column_privileges for anon/authenticated, and it failed — but so
-- would aqar and every one of the 100+ fleet tables, because that view lists grants that exist
-- without resolving the table-level REVOKE that sits over them. The EFFECTIVE privilege is what
-- matters and it was verified live against the anon key before this was re-applied:
--   select id, source_capture …  → 42501 permission denied
--   select id, price_annual   …  → 200 with the row
-- so the assertion here uses has_column_privilege(), which answers the effective question.
DO $$
DECLARE t text; tbl text; cols text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
    tbl := 'abaad_' || t || '_listings';
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
    tbl := 'abaad_' || t || '_listings';
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE EXCEPTION '% was not created', tbl;
    END IF;
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = tbl
           AND column_name IN ('city_ar','district_ar','city_id','region_id')) <> 4 THEN
      RAISE EXCEPTION '% exists without all of city_ar/district_ar/city_id/region_id — the PGRST204 trap is still open', tbl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = ('public.' || tbl)::regclass AND contype = 'u'
                      AND pg_get_constraintdef(oid) = 'UNIQUE (ad_number)') THEN
      RAISE EXCEPTION '% has no UNIQUE (ad_number) — the scraper upserts on_conflict=ad_number', tbl;
    END IF;
    IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = ('public.' || tbl)::regclass AND NOT tgisinternal
          AND tgname IN ('trg_set_deactivated_at','trg_archive_hard_delete','zz_redact_pii')) <> 3 THEN
      RAISE EXCEPTION '% is missing a fleet trigger (deactivated_at / hard-delete archive / PII)', tbl;
    END IF;
    -- EFFECTIVE privilege, the question that actually matters for PDPL
    IF has_column_privilege('anon', ('public.' || tbl)::regclass, 'source_capture', 'SELECT') THEN
      RAISE EXCEPTION '% lets anon read source_capture — PDPL grant is wrong', tbl;
    END IF;
    IF NOT has_column_privilege('anon', ('public.' || tbl)::regclass, 'price_annual', 'SELECT') THEN
      RAISE EXCEPTION '% does not let anon read price_annual — the column grant did not land', tbl;
    END IF;
  END LOOP;
END $verify$;
