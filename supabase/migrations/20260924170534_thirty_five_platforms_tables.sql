-- Thirty-five platforms onboarded in one pass, 2026-09-24: their listing tables. Nothing here is
-- visible to users on its own — the companion migration (…_thirty_five_platforms_wiring_into_search)
-- wires the tables into search.
--
--   dwelleo (DWL)  aqalemhajer (AQH)  sakani (SKI)  shatri (SHT)  alqasem (QSM)  fkralemar (FKR)
--   wadod (WDD)  almuteb (MTB)  aalbarrak (BRK)  alrifai (RFI)  sodasyat (SDS)  hasaad (HSD)
--   aqaralriyadh (AQR)  justsa (JST)  snam (SNM)  jawher (JWH)  m3tmd (MQR)  senan (SNN)
--   goldendeal (GDL)  thousand (ALF)  yameen (YMN)  ebriza (EBZ)  eilmalriyada (ELR)  daryusuf (DYS)
--   albdah (BDH)  eydah (EYD)  tamyaz (TMZ)  hazim (HZM)  villassa (VLS)  marksa (MAR)
--   rightcompound (RCP)  livingcompound (LCP)  azure (AZR)  expattrusted (ETH)  flow (FLW)
--
-- alajlan is NOT here: parked, never built (no per-listing URL exists). dwelleo is a RE-ONBOARDED
-- platform (retired 2026-06-23, formalised by 20260810124110; owner decision 2026-09-24 to bring it
-- back): its old tables were dropped, so both are created fresh here like every other pair.
--
-- Same shape as the eleven-platform tables (20260921185629) and the seven before them
-- (20260920002620): clone the canonical aqar_residential_listings column set INCLUDING ALL
-- (defaults, the ad_number unique key the scrapers upsert on, checks, indexes), enable RLS, add the
-- public-read policy, and add the four location columns the aqar template does not carry.
-- Every one of the 35 scrapers writes through db._wasalt_batch onto this same column set. Their
-- row literals were AST-read (scrapers/common/tests/test_scraper_rows_only_use_real_columns.py,
-- BATCH_2026_09_24, which now runs in CI) and every key is inside the template +
-- city_ar/district_ar/city_id/region_id. The AST read found three exceptions — goldendeal and
-- rightcompound (and yameen, which inherits goldendeal's map_listing) put TOP-LEVEL
-- "latitude"/"longitude" keys in the row, which NO listing table has (PostgREST would reject
-- every batch carrying a coordinate with PGRST204) — fixed scraper-side in this same change: both
-- now live in additional_info ({"latitude": …, "longitude": …}), which listing_rich_attrs already
-- reads. No coordinate column is added here. rightcompound and azure write their
-- *_residential_listings table only; the
-- commercial twin is created anyway so every platform has the same two tables the fleet's
-- allowlists, RPCs and verifiers enumerate (verify-all-platforms-have-extra-attrs-branch is
-- table-grained).
--
-- city_id / region_id are added HERE, in the same migration: one unknown key makes PostgREST reject
-- the ENTIRE batch with PGRST204 (20260919065332 lost 1,809 mapped rows that way).
--
-- Two things LIKE ... INCLUDING ALL does NOT carry over, both closed here exactly as 20260921185629
-- closed them:
--   · the three fleet triggers every listing table has: trg_set_deactivated_at (prune_unseen writes
--     active=false and relies on it to stamp deactivated_at), trg_archive_hard_delete (a hard delete
--     lands in purged_listings_archive), zz_redact_pii (title/description PDPL redaction in SQL,
--     behind the Python one). All three functions are table-generic.
--   · the PDPL column grant (20260809114318): anon/authenticated get SELECT on every column EXCEPT
--     source_capture. A column REVOKE cannot carve a hole in a table-level grant, so the table grant is
--     revoked and the column list granted back.
DO $$
DECLARE p text; t text; tbl text; cols text;
BEGIN
  FOREACH p IN ARRAY ARRAY['dwelleo','aqalemhajer','sakani','shatri','alqasem','fkralemar',
                           'wadod','almuteb','aalbarrak','alrifai','sodasyat','hasaad',
                           'aqaralriyadh','justsa','snam','jawher','m3tmd','senan',
                           'goldendeal','thousand','yameen','ebriza','eilmalriyada',
                           'daryusuf','albdah','eydah','tamyaz','hazim','villassa','marksa',
                           'rightcompound','livingcompound','azure','expattrusted','flow'] LOOP
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
  FOREACH p IN ARRAY ARRAY['dwelleo','aqalemhajer','sakani','shatri','alqasem','fkralemar',
                           'wadod','almuteb','aalbarrak','alrifai','sodasyat','hasaad',
                           'aqaralriyadh','justsa','snam','jawher','m3tmd','senan',
                           'goldendeal','thousand','yameen','ebriza','eilmalriyada',
                           'daryusuf','albdah','eydah','tamyaz','hazim','villassa','marksa',
                           'rightcompound','livingcompound','azure','expattrusted','flow'] LOOP
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
  RAISE NOTICE 'all 70 tables present: location columns, UNIQUE (ad_number), fleet triggers, PDPL column grant';
END $verify$;
