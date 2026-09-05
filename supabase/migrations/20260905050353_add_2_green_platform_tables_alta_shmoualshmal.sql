-- Two new GREEN-audited Saudi platforms (owner directive 2026-09-05, continuing the 40-candidate
-- audit). Same additive, idempotent shape as add_5_green_platform_tables_therc_aouj_abralosol_
-- arkaan_rawasidark (20260903025826): clone the canonical aqar_residential_listings column set so
-- every downstream consumer sees an identical row shape, then enable RLS + the public-read policy.
--
-- DELIBERATELY NOT yet added to active_listing_ids_v2 / listing_rich_attrs / listing_extra_attrs /
-- listing_location_index. Rows ingested here are INVISIBLE to search until a separate union rebuild
-- lands — a safe staging step, so the scrapers can be verified against production data before
-- anything becomes user-visible.
--
--   alta          ألتا للخدمات العقارية   alta.com.sa         17 listings (WP REST + detail HTML)
--   shmoualshmal  شموع الشمال العقارية    shmoua-alshmal.com   6 listings (Houzez WP REST)
--
-- A THIRD candidate, danaalkhair (دانة الخير), was DEFERRED by the owner on 2026-09-05 and is
-- deliberately absent here. Its data is otherwise the richest of the three, but it publishes NO
-- resolvable city: the Arabic taxonomy REST bases 404, the detail page renders a «موقع العقار»
-- label with no value, REAL_HOMES_property_address is empty, and the lat/long is a DEFAULT Riyadh
-- pin (24.74227, 46.67275) repeated across 7 of 11 groups — including listings whose own slug and
-- districts are Khobar. Owner ruling: source truth first for location; do not infer a city from
-- districts, coordinates or company location. It returns only with truthful source evidence.
DO $$
DECLARE k text; t text;
BEGIN
  FOREACH k IN ARRAY ARRAY['alta','shmoualshmal'] LOOP
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
