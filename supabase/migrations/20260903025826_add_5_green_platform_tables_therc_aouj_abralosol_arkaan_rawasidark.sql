-- Five new GREEN-audited Saudi platforms (owner directive 2026-09-02: audit 40 candidates, then
-- implement the safe ones). Same additive, idempotent shape as add_october_platform_tables
-- (20260623004212) and add_5_platform_tables_dealapp_souq24_dwelleo_erapulse_nowaisiry
-- (20260622225309): clone the canonical aqar_residential_listings column set so every downstream
-- consumer sees an identical row shape, then enable RLS + the public-read policy every other
-- listings table carries.
--
-- These tables are deliberately NOT yet added to active_listing_ids_v2 / listing_rich_attrs /
-- listing_extra_attrs / listing_location_index. Until that separate union rebuild lands, rows
-- ingested here are INVISIBLE to search — which makes this a safe staging step: the scrapers can
-- fill and be verified against production data before anything becomes user-visible.
--
--   therc      الخيار الصحيح للخدمات العقارية  therc.sa          ~397 listings (JSON-LD)
--   aouj       عوج العقارية                    aoujestates.com   ~76   (public JSON API)
--   abralosol  عبر الأصول للخدمات العقارية     abralosol.com     ~2761 (Drupal /node)
--   arkaan     أركان العقار                    arkaanalaqar.com  ~1072 (server-rendered)
--   rawasidark رواسي دارك العقارية             rawasi-dark.com   ~101  (RSC payload)
DO $$
DECLARE k text; t text;
BEGIN
  FOREACH k IN ARRAY ARRAY['therc','aouj','abralosol','arkaan','rawasidark'] LOOP
    FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I (LIKE aqar_residential_listings INCLUDING ALL)',
        k||'_'||t||'_listings');
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', k||'_'||t||'_listings');
      EXECUTE format('DROP POLICY IF EXISTS "public read" ON %I', k||'_'||t||'_listings');
      EXECUTE format('CREATE POLICY "public read" ON %I FOR SELECT USING (true)', k||'_'||t||'_listings');
    END LOOP;
  END LOOP;
END $$;

SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name ~ '^(therc|aouj|abralosol|arkaan|rawasidark)_(residential|commercial)_listings$'
ORDER BY 1;
