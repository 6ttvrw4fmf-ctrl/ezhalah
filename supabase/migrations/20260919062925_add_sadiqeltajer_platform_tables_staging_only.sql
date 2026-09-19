-- صادق التاجر (sadiq-eltajer.sa) — 1,779 listings, onboarding 2026-09-19.
-- Additive and idempotent, same shape as the ksaaqar tables (20260919061628): clone the canonical
-- aqar_residential_listings column set, enable RLS, add the public-read policy, and add the two
-- Arabic-native shadow columns in the SAME migration so the first sweep cannot hit PGRST204.
--
-- STAGING ONLY: not yet an arm of active_listing_ids_v2 or any AF view, so rows are invisible to
-- search until a separate activation lands.
--
-- SOURCE NOTES (probed live before any code):
--   · No REST API. The sitemap enumerates the catalogue: 1,779 URLs under /ads/.
--   · Each page is 233 KB but the listing's OWN content is the first ~600-1,600 chars of text.
--     Everything after «اعلانات مشابهة» belongs to OTHER listings, each with its own price and
--     area — a whole-page price regex puts a neighbour's figure on this card. Every value is read
--     from a section truncated at that marker, by construction rather than by a blocklist.
--   · The header carries the price; the description separately states «الدخل السنوي» — the
--     property's annual RENTAL INCOME, not its sale price. They must never be confused.
--   · 23% of priced listings are PRICE PER SQUARE METRE and only a third of those say «للمتر».
--     «220 ريال» on a 4,412 m² plot is 0.05 SAR/m² as a total — impossible — and an ordinary
--     Buraydah land price per metre. Those land in price_per_meter, where PPM x area yields the
--     shown total (owner 2026-09-03); anything above 1 SAR/m² is kept as the total as printed.
--   · Coverage measured on 40 real pages BEFORE the parser was written: district 100%, area 94%,
--     price 61%, age 30%, bedrooms 25%, bathrooms 17%. 97% of listings map; the remainder are
--     «مخططات» (subdivision plans), which are not single properties and are skipped, not guessed.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['residential','commercial'] LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I (LIKE aqar_residential_listings INCLUDING ALL)',
      'sadiqeltajer_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', 'sadiqeltajer_'||t||'_listings');
    EXECUTE format('DROP POLICY IF EXISTS "public read" ON %I', 'sadiqeltajer_'||t||'_listings');
    EXECUTE format('CREATE POLICY "public read" ON %I FOR SELECT USING (true)',
                   'sadiqeltajer_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS city_ar text',
                   'sadiqeltajer_'||t||'_listings');
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS district_ar text',
                   'sadiqeltajer_'||t||'_listings');
  END LOOP;
END $$;
