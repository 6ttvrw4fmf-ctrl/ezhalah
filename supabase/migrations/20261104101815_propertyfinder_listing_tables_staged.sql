-- Property Finder Saudi (propertyfinder.sa, owner approved 2026-11-04) — its two listing tables, STAGED: rows are
-- stored, nothing reaches a customer. Same shape and fleet triggers as haraj's tables (clone
-- aqar_residential_listings INCLUDING ALL, the four location columns, deactivated_at / hard-delete archive / PII
-- redaction triggers), with ONE difference that is the point of staging: anon and authenticated get NO read at
-- all (haraj granted every column but source_capture). The launch grants that same column set; until then the
-- rows are reachable by no app path — not search (the tables are no arm of listing_native_location_v1 /
-- active_listing_ids_v2), not the map, not a deep link, not the REST API.
DO $$
DECLARE t text; tbl text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
    tbl := 'propertyfinder_' || t || '_listings';
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      RAISE NOTICE '% already exists — left as it is', tbl;
      CONTINUE;
    END IF;
    EXECUTE format('CREATE TABLE %I (LIKE aqar_residential_listings INCLUDING ALL)', tbl);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY "public read" ON %I FOR SELECT USING (true)', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_ar text', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS district_ar text', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_id integer', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS region_id integer', tbl);
    EXECUTE format('CREATE TRIGGER trg_set_deactivated_at BEFORE UPDATE ON %I FOR EACH ROW '
                   'WHEN (old.active IS DISTINCT FROM new.active) EXECUTE FUNCTION set_deactivated_at()', tbl);
    EXECUTE format('CREATE TRIGGER trg_archive_hard_delete AFTER DELETE ON %I FOR EACH ROW '
                   'EXECUTE FUNCTION tg_archive_hard_deleted_listing()', tbl);
    EXECUTE format('CREATE TRIGGER zz_redact_pii BEFORE INSERT OR UPDATE ON %I FOR EACH ROW '
                   'EXECUTE FUNCTION trg_redact_user_visible_pii()', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', tbl);
  END LOOP;
END $$;

DO $verify$
DECLARE t text; tbl text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
    tbl := 'propertyfinder_' || t || '_listings';
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE EXCEPTION 'table not created: %', tbl;
    ELSIF (SELECT count(*) FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = tbl
              AND column_name IN ('city_ar','district_ar','city_id','region_id','license_number','license_expiry',
                                  'rent_now_pay_later','photo_urls','additional_info')) <> 9 THEN
      RAISE EXCEPTION '% is missing a location / licence / instalment / photo / facts column', tbl;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint
                       WHERE conrelid = ('public.' || tbl)::regclass AND contype = 'u'
                         AND pg_get_constraintdef(oid) = 'UNIQUE (ad_number)') THEN
      RAISE EXCEPTION '% has no UNIQUE (ad_number) — the scraper upserts on_conflict=ad_number', tbl;
    ELSIF (SELECT count(*) FROM pg_trigger WHERE tgrelid = ('public.' || tbl)::regclass AND NOT tgisinternal
             AND tgname IN ('trg_set_deactivated_at','trg_archive_hard_delete','zz_redact_pii')) <> 3 THEN
      RAISE EXCEPTION '% is missing a fleet trigger (deactivated_at / hard-delete archive / PII)', tbl;
    ELSIF has_table_privilege('anon', 'public.' || tbl, 'SELECT')
       OR has_column_privilege('anon', 'public.' || tbl, 'ad_number', 'SELECT')
       OR has_column_privilege('authenticated', 'public.' || tbl, 'ad_number', 'SELECT') THEN
      RAISE EXCEPTION '% is readable by anon/authenticated — a STAGED platform must not be', tbl;
    END IF;
  END LOOP;
  RAISE NOTICE 'propertyfinder: both tables present, fleet triggers on, unreadable by anon/authenticated (staged)';
END $verify$;
