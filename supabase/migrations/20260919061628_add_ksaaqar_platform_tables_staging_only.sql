-- عقارات السعودية / KSA Aqar (ksaaqar.com) — 1,809 listings, onboarding 2026-09-19.
-- Same additive, idempotent shape as add_2_green_platform_tables_remal_amaall (20260906025027) and
-- the عقاريون tables (20260918232405): clone the canonical aqar_residential_listings column set so
-- every downstream consumer sees an identical row shape, then enable RLS + the public-read policy.
--
-- DELIBERATELY NOT yet a union arm of active_listing_ids_v2 / listing_rich_attrs /
-- listing_extra_attrs / listing_location_index. Rows ingested here are INVISIBLE to search until a
-- separate activation lands — the staging step that caught 9 sold alta listings sitting marked
-- available before any user could reach them.
--
-- SOURCE NOTES (probed live before any code):
--   · WordPress, custom `ad_post` type. /wp-json/wp/v2/ad_post gives the catalogue (X-WP-Total 1809).
--   · The REST record carries NO meta and NO resolvable taxonomy — class_list holds raw term ids
--     (ad_cats-1100, ad_country-1073) and the site exposes no endpoint that resolves them. Every
--     structured value is read from the rendered detail page's labelled spec block instead.
--   · Field coverage measured on 40 real pages BEFORE the parser was written: price 87%,
--     bedrooms 75%, halls 75%, BATHROOMS 72%, furnished 66%, street width 57%, direction 48%,
--     area 48%, age 45%. 82% of discovered listings map; the rest state no type, city or deal.
--   · The site also hosts «النوع: مطلوب» (WANTED) ads — buyer requests, not properties for sale.
--     They are neither Rent nor Buy and are skipped by construction, never shown as inventory.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I (LIKE aqar_residential_listings INCLUDING ALL)',
      'ksaaqar_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', 'ksaaqar_'||t||'_listings');
    EXECUTE format('DROP POLICY IF EXISTS "public read" ON %I', 'ksaaqar_'||t||'_listings');
    EXECUTE format('CREATE POLICY "public read" ON %I FOR SELECT USING (true)',
                   'ksaaqar_'||t||'_listings');
  END LOOP;
END $$;
