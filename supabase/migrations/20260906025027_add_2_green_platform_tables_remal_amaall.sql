-- Two more GREEN-audited Saudi platforms (owner directive 2026-09-06, continuing the 40-candidate
-- audit). Same additive, idempotent shape as add_2_green_platform_tables_alta_shmoualshmal
-- (20260905050353): clone the canonical aqar_residential_listings column set so every downstream
-- consumer sees an identical row shape, then enable RLS + the public-read policy.
--
-- DELIBERATELY NOT yet union arms of active_listing_ids_v2 / listing_rich_attrs /
-- listing_extra_attrs / listing_location_index. Rows ingested here are INVISIBLE to search until a
-- separate activation lands — the staging step that caught 9 sold alta listings sitting marked
-- available before any user could reach them.
--
--   remal   رمال العقارية   remalre.com   87 posts -> 84 listings (WP REST `estate` post type)
--   amaall  آمال العقارية   amaall.com   135 posts ->  50 listings (Houzez; ARABIC ONLY)
--
-- WHY AMAALL IS 50 AND NOT 135. The site publishes every listing TWICE — 68 posts under /en/ and
-- 67 without. Measured 2026-09-06: of 55 distinct price/size/bedroom signatures, 39 appear more
-- than once and every duplicate pair is exactly one EN + one AR post (9,500,000 -> EN 23773 +
-- AR 23751). Ingesting both languages would show every آمال property twice, which is the
-- duplicate-manufacturing failure that got `toor` rejected in this same audit. The scraper takes
-- Arabic only; of those 67, 14 state no transaction at all and 3 name a type we refuse to guess
-- at (إداري, كشك), leaving 50 — of which 14 are source-confirmed sold/rented (active=false).
DO $$
DECLARE k text; t text;
BEGIN
  FOREACH k IN ARRAY ARRAY['remal','amaall'] LOOP
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
