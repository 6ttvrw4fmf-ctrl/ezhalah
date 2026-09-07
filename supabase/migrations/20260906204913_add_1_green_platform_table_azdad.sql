-- Azdad Al Aqariah (ازداد العقارية) -- corrected link for the original 40-candidate audit's
-- "أزداد العقارية" entry (azdadalaqaria.com; the original list's azdad.com.sa is dead). Own
-- Next.js + Supabase stack, NOT a Nuzul/Wasalt-family clone. 25 listings total, 24 real
-- (21 residential + 3 commercial), 1 refused (a genuinely ambiguous bare "أرض" category with no
-- سكني/تجاري word in its own description).
--
-- DELIBERATELY NOT yet a union arm of active_listing_ids_v2 / listing_rich_attrs /
-- listing_extra_attrs / listing_location_index / listing_native_location_v1. Invisible to search
-- until a separate activation, same staged pattern as every prior onboarding.
--
-- city_ar/district_ar/city_id/region_id added alongside the base LIKE-clone (not a follow-up
-- migration) so this platform is correctly wired into listing_native_location_v1's "native" CTE
-- from its first activation -- abwbna/alobid/bahadhabab needed a SEPARATE fix
-- (20260906175800_wire_abwbna_bahadhabab_alobid_into_native_location_v1.sql) because that step was
-- missed the first time; this table starts with the columns that fix depends on already present.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I (LIKE aqar_residential_listings INCLUDING ALL)',
      'azdad_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_ar text', 'azdad_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS district_ar text', 'azdad_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_id integer', 'azdad_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS region_id integer', 'azdad_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', 'azdad_'||t||'_listings');
    EXECUTE format('DROP POLICY IF EXISTS "public read" ON %I', 'azdad_'||t||'_listings');
    EXECUTE format('CREATE POLICY "public read" ON %I FOR SELECT USING (true)', 'azdad_'||t||'_listings');
  END LOOP;
END $$;
