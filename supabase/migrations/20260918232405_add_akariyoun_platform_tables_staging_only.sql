-- عقاريون / Akariyoun (akariyoun.sa) — 274 Riyadh listings, onboarding 2026-09-18.
-- Same additive, idempotent shape as add_2_green_platform_tables_remal_amaall (20260906025027):
-- clone the canonical aqar_residential_listings column set so every downstream consumer sees an
-- identical row shape, then enable RLS + the public-read policy.
--
-- DELIBERATELY NOT yet a union arm of active_listing_ids_v2 / listing_rich_attrs /
-- listing_extra_attrs / listing_location_index. Rows ingested here are INVISIBLE to search until a
-- separate activation lands — the staging step that caught 9 sold alta listings sitting marked
-- available before any user could reach them.
--
-- SOURCE NOTES (probed live before any code):
--   · Riyadh only; the site says so: «حاليًا الأعلانات حصريه فقط على مدينة الرياض».
--   · Plain nginx, no Cloudflare, no proxy needed.
--   · LAND publishes an EXACT total in its spec table («9766912.00») alongside a rounded worded
--     header («9.77 مليون»); built property publishes ONLY the worded header and renders «-» in
--     that cell. The scraper prefers the exact figure and, where only words exist, proves them
--     against the site's own numeric price filter before storing a number (PRICE = SOURCE).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I (LIKE aqar_residential_listings INCLUDING ALL)',
      'akariyoun_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', 'akariyoun_'||t||'_listings');
    EXECUTE format('DROP POLICY IF EXISTS "public read" ON %I', 'akariyoun_'||t||'_listings');
    EXECUTE format('CREATE POLICY "public read" ON %I FOR SELECT USING (true)',
                   'akariyoun_'||t||'_listings');
  END LOOP;
END $$;