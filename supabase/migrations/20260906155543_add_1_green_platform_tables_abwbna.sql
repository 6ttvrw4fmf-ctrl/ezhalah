-- One more GREEN-audited Saudi platform (owner directive 2026-09-06, continuing the 40-candidate
-- audit). Same additive, idempotent shape as prior onboardings.
--
-- DELIBERATELY NOT yet union arms of active_listing_ids_v2 / listing_rich_attrs /
-- listing_extra_attrs / listing_location_index. Invisible to search until a separate activation.
--
--   abwbna   أبوابنا   abwbna.com   215 listings total, 189 available (26 sold/reserved)
--
-- abwbna is a DIFFERENT TENANT of the SAME Nuzul SaaS platform aldarim already scrapes — found by
-- noticing its cover images resolve to the identical nuzul-saas-production S3 bucket family
-- (tenant 3846 vs aldarim's 3567), then confirming the sibling API host
-- (abwbna.nzl-backend.com/api/public/properties) answers with the byte-identical JSON shape, no
-- auth. scrapers/abwbna/run.py is therefore a close clone of scrapers/aldarim/run.py rather than a
-- fresh reverse-engineering — same tri-state flags, kitchen/age resolvers, photo extraction, and
-- full-refresh prune. Live-verified: 152 residential + 37 commercial, 483 images across 189
-- listings with 0 cross-listing reuse, 26 sold/reserved correctly excluded.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I (LIKE aqar_residential_listings INCLUDING ALL)',
      'abwbna_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', 'abwbna_'||t||'_listings');
    EXECUTE format('DROP POLICY IF EXISTS "public read" ON %I', 'abwbna_'||t||'_listings');
    EXECUTE format('CREATE POLICY "public read" ON %I FOR SELECT USING (true)', 'abwbna_'||t||'_listings');
  END LOOP;
END $$;
