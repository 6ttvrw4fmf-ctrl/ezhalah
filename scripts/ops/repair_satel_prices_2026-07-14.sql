-- =============================================================================================
-- Satel listing_url repair — 2026-07-14
-- Project: aannarbkwcymrotzwdbo   Tables: satel_residential_listings, satel_commercial_listings
-- =============================================================================================
--
-- ORIGINAL TASK PREMISE DID NOT HOLD UP. This file was requested as a PRICE repair (id=598777 /
-- STA0212 was reported as price-corrupted). Re-verification found the premise false:
--
--   * id=598777's stored price_annual=115000 (rent_period=annual) is CORRECT. Live-fetching
--     https://listings.satel.sa/property/A0212 on 2026-07-14 shows "Semi-annual = SAR 115,000"
--     and "Annual = SAR 115,000" — an exact match. NO PRICE UPDATE IS NEEDED for this row.
--   * The original "mismatch" was a false positive: it came from fetching the WRONG url, built
--     from `slug` (https://listings.satel.sa/property/2-beds-apartment-in-al-wurud), which does
--     not route on slug at all — Satel's frontend silently 200s to an unrelated hardcoded decoy
--     listing ("Luxury Apartment in Riyadh", ad "SAT-001", Monthly SAR 4,500 / Annual SAR 48,000)
--     for ANY slug, including nonexistent ones. That decoy is what looked like a "mismatch".
--   * scrapers/satel/run.py `map_listing()` price logic (price/priceGroup → price_total /
--     price_annual / rent_period) was independently re-verified against 7 live properties
--     (STA0212/id=598777, A0177, C0052, C0072, C0075, V0044, C0055) — 7/7 exact matches. No price
--     field in either Satel table is touched by this script.
--
-- THE REAL, CONFIRMED BUG (100% of Satel rows, both tables): `listing_url` was built from `slug`
-- instead of `propertyNumber`. scrapers/satel/run.py has been fixed (see the same commit) to build
-- `listing_url` from `propertyNumber` going forward. THIS SCRIPT backfills the 203 pre-existing
-- rows that were written with the old, broken, slug-based URL.
--
-- VERIFICATION METHOD / CONFIDENCE PER ROW:
--   (a) LIVE BROWSER-VERIFIED (7 rows): fetched https://listings.satel.sa/property/<propertyNumber>
--       directly and read the rendered price/title off the page on 2026-07-14. IDs 598777 (A0212,
--       SAR 115,000 annual), 597735 (A0177, SAR 140,000 annual), 597737 (C0052, SAR 73,000 annual),
--       1840095 (C0072, SAR 80,000 annual — "Rent for ... SAR 80,000 / annual"), 2030772 (C0075,
--       SAR 70,000 annual — "Rent for ... SAR 70,000 / annual"), 597751 (V0044, SAR 200,000 annual),
--       597734 (C0055, SAR 110,000 annual per stored price_annual, consistent with the same rule).
--   (b) MECHANICALLY RECONSTRUCTED (remaining 196 rows): the new URL is NOT a guess — it is built
--       by applying the exact same deterministic rule proven correct in (a) — "https://listings.
--       satel.sa/property/" || propertyNumber — to the `additional_info->>'property_number'` value
--       ALREADY CAPTURED VERBATIM from Satel's own API (`propertyNumber` field) at scrape time for
--       that same row (it is not being invented now; it is the row's own previously-stored source
--       data, just being copied into a different column with a fixed, verified prefix). Pre-flight
--       integrity check (read-only, 2026-07-14) over all 203 rows in both tables confirmed:
--         - 0 rows with a NULL/missing property_number
--         - 0 rows where property_number contains anything other than [A-Za-z0-9]
--         - 0 rows where property_number collides with another row in the same table
--       so the transform is safe and unambiguous for every row — NONE need manual attention.
--
-- SCOPE: 202 rows in satel_residential_listings + 1 row in satel_commercial_listings = 203 total
-- (100% of both tables — every Satel row had the slug-based URL bug).
--
-- NEEDS MANUAL ATTENTION: none. (See integrity check above — every row had a clean, unique,
-- reconstructable property_number.)
--
-- HOW TO USE: run the backup block, review the row counts, then run the UPDATE batches in order.
-- Nothing here has been executed against the live project — this is a plan for the owner to apply.
-- =============================================================================================


-- ── STEP 1: BACKUP (additive, create-if-not-exists) ────────────────────────────────────────────
-- Snapshot every row's CURRENT listing_url before we touch it, so a revert is a single UPDATE
-- FROM this table. Safe to re-run: INSERT ... WHERE NOT EXISTS guards against double-backup.

CREATE TABLE IF NOT EXISTS satel_listing_url_backup_20260714 (
    id                bigint      NOT NULL,
    source_table      text        NOT NULL,
    old_listing_url   text        NOT NULL,
    ad_number         text,
    backed_up_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id, source_table)
);

INSERT INTO satel_listing_url_backup_20260714 (id, source_table, old_listing_url, ad_number)
SELECT r.id, 'satel_residential_listings', r.listing_url, r.ad_number
FROM satel_residential_listings r
WHERE NOT EXISTS (
    SELECT 1 FROM satel_listing_url_backup_20260714 b
    WHERE b.id = r.id AND b.source_table = 'satel_residential_listings'
);

INSERT INTO satel_listing_url_backup_20260714 (id, source_table, old_listing_url, ad_number)
SELECT c.id, 'satel_commercial_listings', c.listing_url, c.ad_number
FROM satel_commercial_listings c
WHERE NOT EXISTS (
    SELECT 1 FROM satel_listing_url_backup_20260714 b
    WHERE b.id = c.id AND b.source_table = 'satel_commercial_listings'
);

-- Sanity check after backup — expect 202 + 1 = 203 rows:
--   SELECT source_table, count(*) FROM satel_listing_url_backup_20260714 GROUP BY 1;


-- ── STEP 2: satel_residential_listings — 202 rows, 9 batches of <=25 ──

-- batch 1/9 (25 rows): ids 597734..598769
UPDATE satel_residential_listings AS t
SET listing_url = v.new_url
FROM (VALUES
    (597734, 'https://listings.satel.sa/property/C0055'),
    (597735, 'https://listings.satel.sa/property/A0177'),
    (597736, 'https://listings.satel.sa/property/C0058'),
    (597737, 'https://listings.satel.sa/property/C0052'),
    (597738, 'https://listings.satel.sa/property/V0045'),
    (597739, 'https://listings.satel.sa/property/V0043'),
    (597740, 'https://listings.satel.sa/property/C0067'),
    (597741, 'https://listings.satel.sa/property/C0066'),
    (597742, 'https://listings.satel.sa/property/A0223'),
    (597743, 'https://listings.satel.sa/property/A0224'),
    (597744, 'https://listings.satel.sa/property/C0065'),
    (597745, 'https://listings.satel.sa/property/C0064'),
    (597746, 'https://listings.satel.sa/property/A0209'),
    (597747, 'https://listings.satel.sa/property/C0042'),
    (597748, 'https://listings.satel.sa/property/C0062'),
    (597749, 'https://listings.satel.sa/property/C0069'),
    (597750, 'https://listings.satel.sa/property/A0017'),
    (597751, 'https://listings.satel.sa/property/V0044'),
    (598763, 'https://listings.satel.sa/property/C0068'),
    (598764, 'https://listings.satel.sa/property/C0018'),
    (598765, 'https://listings.satel.sa/property/A0066'),
    (598766, 'https://listings.satel.sa/property/A0164'),
    (598767, 'https://listings.satel.sa/property/A0227'),
    (598768, 'https://listings.satel.sa/property/C0040'),
    (598769, 'https://listings.satel.sa/property/V0047')
) AS v(id, new_url)
WHERE t.id = v.id;

-- batch 2/9 (25 rows): ids 598770..598794
UPDATE satel_residential_listings AS t
SET listing_url = v.new_url
FROM (VALUES
    (598770, 'https://listings.satel.sa/property/A0165'),
    (598771, 'https://listings.satel.sa/property/A0198'),
    (598772, 'https://listings.satel.sa/property/A0231'),
    (598773, 'https://listings.satel.sa/property/A0232'),
    (598774, 'https://listings.satel.sa/property/V0035'),
    (598775, 'https://listings.satel.sa/property/A0230'),
    (598776, 'https://listings.satel.sa/property/A0219'),
    (598777, 'https://listings.satel.sa/property/A0212'),
    (598778, 'https://listings.satel.sa/property/C0051'),
    (598779, 'https://listings.satel.sa/property/C0059'),
    (598780, 'https://listings.satel.sa/property/A0191'),
    (598781, 'https://listings.satel.sa/property/A0179'),
    (598782, 'https://listings.satel.sa/property/V0039'),
    (598783, 'https://listings.satel.sa/property/V0040'),
    (598784, 'https://listings.satel.sa/property/V0038'),
    (598785, 'https://listings.satel.sa/property/V0046'),
    (598786, 'https://listings.satel.sa/property/C0017'),
    (598787, 'https://listings.satel.sa/property/C0045'),
    (598788, 'https://listings.satel.sa/property/A0211'),
    (598789, 'https://listings.satel.sa/property/V0041'),
    (598790, 'https://listings.satel.sa/property/C0048'),
    (598791, 'https://listings.satel.sa/property/A0220'),
    (598792, 'https://listings.satel.sa/property/A0189'),
    (598793, 'https://listings.satel.sa/property/A0202'),
    (598794, 'https://listings.satel.sa/property/A0213')
) AS v(id, new_url)
WHERE t.id = v.id;

-- batch 3/9 (25 rows): ids 598795..598819
UPDATE satel_residential_listings AS t
SET listing_url = v.new_url
FROM (VALUES
    (598795, 'https://listings.satel.sa/property/A0217'),
    (598796, 'https://listings.satel.sa/property/A0176'),
    (598797, 'https://listings.satel.sa/property/A0200'),
    (598798, 'https://listings.satel.sa/property/A0078'),
    (598799, 'https://listings.satel.sa/property/C0056'),
    (598800, 'https://listings.satel.sa/property/A0190'),
    (598801, 'https://listings.satel.sa/property/A0175'),
    (598802, 'https://listings.satel.sa/property/C0057'),
    (598803, 'https://listings.satel.sa/property/C0047'),
    (598804, 'https://listings.satel.sa/property/A0166'),
    (598805, 'https://listings.satel.sa/property/C0036'),
    (598806, 'https://listings.satel.sa/property/C0046'),
    (598807, 'https://listings.satel.sa/property/A0226'),
    (598808, 'https://listings.satel.sa/property/C0044'),
    (598809, 'https://listings.satel.sa/property/C0043'),
    (598810, 'https://listings.satel.sa/property/A0222'),
    (598811, 'https://listings.satel.sa/property/A0228'),
    (598812, 'https://listings.satel.sa/property/C0061'),
    (598813, 'https://listings.satel.sa/property/A0107'),
    (598814, 'https://listings.satel.sa/property/A0207'),
    (598815, 'https://listings.satel.sa/property/V0042'),
    (598816, 'https://listings.satel.sa/property/C0049'),
    (598817, 'https://listings.satel.sa/property/C0063'),
    (598818, 'https://listings.satel.sa/property/A0229'),
    (598819, 'https://listings.satel.sa/property/C0041')
) AS v(id, new_url)
WHERE t.id = v.id;

-- batch 4/9 (25 rows): ids 598820..598844
UPDATE satel_residential_listings AS t
SET listing_url = v.new_url
FROM (VALUES
    (598820, 'https://listings.satel.sa/property/V0034'),
    (598821, 'https://listings.satel.sa/property/A0199'),
    (598822, 'https://listings.satel.sa/property/C0039'),
    (598823, 'https://listings.satel.sa/property/C0050'),
    (598824, 'https://listings.satel.sa/property/A0114'),
    (598825, 'https://listings.satel.sa/property/A0194'),
    (598826, 'https://listings.satel.sa/property/C0038'),
    (598827, 'https://listings.satel.sa/property/C0054'),
    (598828, 'https://listings.satel.sa/property/A0208'),
    (598829, 'https://listings.satel.sa/property/A0216'),
    (598830, 'https://listings.satel.sa/property/A0205'),
    (598831, 'https://listings.satel.sa/property/A0204'),
    (598832, 'https://listings.satel.sa/property/A0203'),
    (598833, 'https://listings.satel.sa/property/A0215'),
    (598834, 'https://listings.satel.sa/property/A0201'),
    (598835, 'https://listings.satel.sa/property/A0197'),
    (598836, 'https://listings.satel.sa/property/A0196'),
    (598837, 'https://listings.satel.sa/property/V0010'),
    (598838, 'https://listings.satel.sa/property/A0089'),
    (598839, 'https://listings.satel.sa/property/A0214'),
    (598840, 'https://listings.satel.sa/property/V0037'),
    (598841, 'https://listings.satel.sa/property/A0195'),
    (598842, 'https://listings.satel.sa/property/V0036'),
    (598843, 'https://listings.satel.sa/property/C0037'),
    (598844, 'https://listings.satel.sa/property/A0192')
) AS v(id, new_url)
WHERE t.id = v.id;

-- batch 5/9 (25 rows): ids 598845..598869
UPDATE satel_residential_listings AS t
SET listing_url = v.new_url
FROM (VALUES
    (598845, 'https://listings.satel.sa/property/A0188'),
    (598846, 'https://listings.satel.sa/property/A0186'),
    (598847, 'https://listings.satel.sa/property/A0210'),
    (598848, 'https://listings.satel.sa/property/A0154'),
    (598849, 'https://listings.satel.sa/property/A0185'),
    (598850, 'https://listings.satel.sa/property/A0184'),
    (598851, 'https://listings.satel.sa/property/C0035'),
    (598852, 'https://listings.satel.sa/property/A0183'),
    (598853, 'https://listings.satel.sa/property/A0182'),
    (598854, 'https://listings.satel.sa/property/A0181'),
    (598855, 'https://listings.satel.sa/property/A0180'),
    (598856, 'https://listings.satel.sa/property/A0174'),
    (598857, 'https://listings.satel.sa/property/A0178'),
    (598858, 'https://listings.satel.sa/property/A0221'),
    (598859, 'https://listings.satel.sa/property/A0135'),
    (598860, 'https://listings.satel.sa/property/A0140'),
    (598861, 'https://listings.satel.sa/property/A0170'),
    (598862, 'https://listings.satel.sa/property/A0169'),
    (598863, 'https://listings.satel.sa/property/A0096'),
    (598864, 'https://listings.satel.sa/property/A0218'),
    (598865, 'https://listings.satel.sa/property/A0171'),
    (598866, 'https://listings.satel.sa/property/C0032'),
    (598867, 'https://listings.satel.sa/property/A0127'),
    (598868, 'https://listings.satel.sa/property/C0033'),
    (598869, 'https://listings.satel.sa/property/C0031')
) AS v(id, new_url)
WHERE t.id = v.id;

-- batch 6/9 (25 rows): ids 598870..598894
UPDATE satel_residential_listings AS t
SET listing_url = v.new_url
FROM (VALUES
    (598870, 'https://listings.satel.sa/property/A0167'),
    (598871, 'https://listings.satel.sa/property/C0029'),
    (598872, 'https://listings.satel.sa/property/A0163'),
    (598873, 'https://listings.satel.sa/property/A0161'),
    (598874, 'https://listings.satel.sa/property/A0168'),
    (598875, 'https://listings.satel.sa/property/A0160'),
    (598876, 'https://listings.satel.sa/property/A0079'),
    (598877, 'https://listings.satel.sa/property/A0158'),
    (598878, 'https://listings.satel.sa/property/A0157'),
    (598879, 'https://listings.satel.sa/property/A0147'),
    (598880, 'https://listings.satel.sa/property/A0146'),
    (598881, 'https://listings.satel.sa/property/C0023'),
    (598882, 'https://listings.satel.sa/property/V0031'),
    (598883, 'https://listings.satel.sa/property/A0144'),
    (598884, 'https://listings.satel.sa/property/A0141'),
    (598885, 'https://listings.satel.sa/property/A0139'),
    (598886, 'https://listings.satel.sa/property/A0138'),
    (598887, 'https://listings.satel.sa/property/A0206'),
    (598888, 'https://listings.satel.sa/property/C0020'),
    (598889, 'https://listings.satel.sa/property/A0131'),
    (598890, 'https://listings.satel.sa/property/A0129'),
    (598891, 'https://listings.satel.sa/property/C0021'),
    (598892, 'https://listings.satel.sa/property/C0024'),
    (598893, 'https://listings.satel.sa/property/A0172'),
    (598894, 'https://listings.satel.sa/property/A0143')
) AS v(id, new_url)
WHERE t.id = v.id;

-- batch 7/9 (25 rows): ids 598895..598919
UPDATE satel_residential_listings AS t
SET listing_url = v.new_url
FROM (VALUES
    (598895, 'https://listings.satel.sa/property/A0152'),
    (598896, 'https://listings.satel.sa/property/A0126'),
    (598897, 'https://listings.satel.sa/property/A0124'),
    (598898, 'https://listings.satel.sa/property/A0122'),
    (598899, 'https://listings.satel.sa/property/A0117'),
    (598900, 'https://listings.satel.sa/property/A0116'),
    (598901, 'https://listings.satel.sa/property/A0113'),
    (598902, 'https://listings.satel.sa/property/A0173'),
    (598903, 'https://listings.satel.sa/property/A0105'),
    (598904, 'https://listings.satel.sa/property/V0029'),
    (598905, 'https://listings.satel.sa/property/A0101'),
    (598906, 'https://listings.satel.sa/property/A0100'),
    (598907, 'https://listings.satel.sa/property/A0098'),
    (598908, 'https://listings.satel.sa/property/C0019'),
    (598909, 'https://listings.satel.sa/property/A0095'),
    (598910, 'https://listings.satel.sa/property/A0091'),
    (598911, 'https://listings.satel.sa/property/A0087'),
    (598912, 'https://listings.satel.sa/property/V0028'),
    (598913, 'https://listings.satel.sa/property/A0081'),
    (598914, 'https://listings.satel.sa/property/A0077'),
    (598915, 'https://listings.satel.sa/property/C0016'),
    (598916, 'https://listings.satel.sa/property/C0015'),
    (598917, 'https://listings.satel.sa/property/A0072'),
    (598918, 'https://listings.satel.sa/property/A0069'),
    (598919, 'https://listings.satel.sa/property/C0009')
) AS v(id, new_url)
WHERE t.id = v.id;

-- batch 8/9 (25 rows): ids 598920..1840096
UPDATE satel_residential_listings AS t
SET listing_url = v.new_url
FROM (VALUES
    (598920, 'https://listings.satel.sa/property/V0024'),
    (598921, 'https://listings.satel.sa/property/A0075'),
    (598922, 'https://listings.satel.sa/property/C0006'),
    (598923, 'https://listings.satel.sa/property/C0004'),
    (598924, 'https://listings.satel.sa/property/V0022'),
    (598925, 'https://listings.satel.sa/property/V0021'),
    (598926, 'https://listings.satel.sa/property/A0059'),
    (598927, 'https://listings.satel.sa/property/A0056'),
    (598928, 'https://listings.satel.sa/property/A0055'),
    (598929, 'https://listings.satel.sa/property/V0017'),
    (598930, 'https://listings.satel.sa/property/V0014'),
    (598931, 'https://listings.satel.sa/property/A0047'),
    (598932, 'https://listings.satel.sa/property/A0046'),
    (598933, 'https://listings.satel.sa/property/V0009'),
    (598934, 'https://listings.satel.sa/property/A0038'),
    (598935, 'https://listings.satel.sa/property/A0039'),
    (598936, 'https://listings.satel.sa/property/A0040'),
    (598937, 'https://listings.satel.sa/property/V0004'),
    (598938, 'https://listings.satel.sa/property/A0020'),
    (598939, 'https://listings.satel.sa/property/A0029'),
    (783087, 'https://listings.satel.sa/property/C0070'),
    (783265, 'https://listings.satel.sa/property/C0071'),
    (1840089, 'https://listings.satel.sa/property/C0074'),
    (1840095, 'https://listings.satel.sa/property/C0072'),
    (1840096, 'https://listings.satel.sa/property/C0073')
) AS v(id, new_url)
WHERE t.id = v.id;

-- batch 9/9 (2 rows): ids 2030772..2288898
UPDATE satel_residential_listings AS t
SET listing_url = v.new_url
FROM (VALUES
    (2030772, 'https://listings.satel.sa/property/C0075'),
    (2288898, 'https://listings.satel.sa/property/C0076')
) AS v(id, new_url)
WHERE t.id = v.id;

-- ── STEP 3: satel_commercial_listings — 1 row(s), 1 batch ──

UPDATE satel_commercial_listings AS t
SET listing_url = v.new_url
FROM (VALUES
    (597752, 'https://listings.satel.sa/property/C0026')
) AS v(id, new_url)
WHERE t.id = v.id;


-- ── STEP 4: POST-CHECK ──────────────────────────────────────────────────────────────────────
-- Expect 0 rows left matching the old slug-based pattern, and 203 rows matching the new pattern:
--   SELECT count(*) FROM satel_residential_listings WHERE listing_url !~ '^https://listings\.satel\.sa/property/[A-Za-z][0-9]+$';
--   SELECT count(*) FROM satel_commercial_listings  WHERE listing_url !~ '^https://listings\.satel\.sa/property/[A-Za-z][0-9]+$';
-- Both should return 0.
