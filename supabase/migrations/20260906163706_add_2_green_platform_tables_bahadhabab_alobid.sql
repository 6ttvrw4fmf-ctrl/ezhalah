-- Two more GREEN-audited Saudi platforms (owner directive 2026-09-06, continuing the 40-candidate
-- audit). Same additive, idempotent shape as prior onboardings.
--
-- DELIBERATELY NOT yet union arms of active_listing_ids_v2 / listing_rich_attrs /
-- listing_extra_attrs / listing_location_index. Invisible to search until a separate activation.
--
--   bahadhabab   باحة الضباب        bahadhabab-res.com   71 listings total, 53 available
--   alobid       مكتب العبيد         alobidoffice.com     139 listings total, 138 available
--
-- Both are Nuzul SaaS tenants (third and fourth found, alongside aldarim and abwbna): the site's
-- own 'nzl-backend.com' subdomain is visible in its page HTML, giving the exact tenant subdomain
-- rather than guessing from the site's own domain (bahadhabab-res.nzl-backend.com does NOT match
-- bahadhabab.com; alobidoffice.nzl-backend.com DOES match alobidoffice.com). Same public JSON API,
-- no auth, byte-identical shape to aldarim/abwbna.
--
-- bahadhabab publishes city:null and district:null on EVERY row -- verified live 2026-09-06, no
-- false signal (no default-pin coordinate). Owner ruling (2026-09-06): this advertiser is a
-- single-region brokerage in الباحة -- city is hardcoded to Al Baha for every row as a confirmed
-- business fact, not an inference. District is read from the source's own hand-typed «الحي: …»
-- line inside description_ar where it states one (12/71 sampled), never invented where absent.
DO $$
DECLARE k text; t text;
BEGIN
  FOREACH k IN ARRAY ARRAY['bahadhabab','alobid'] LOOP
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
