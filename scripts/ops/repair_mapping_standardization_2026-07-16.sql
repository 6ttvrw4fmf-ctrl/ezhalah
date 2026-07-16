-- =============================================================================================
-- Mapping-standardization data repair (types + city labels) — 2026-07-16
-- =============================================================================================
-- DO NOT EXECUTE AGAINST PRODUCTION WITHOUT OWNER SIGN-OFF. This file is a prepared, reviewed
-- artifact only (project rules: Approval-workflow-rule + the permanent repair standard —
-- backup-first, exact-id batches ≤25, per-row source proof, verify, sync the search index).
--
-- CONTEXT: the 2026-07-16 normalize-unification (PR #102) preserved every cross-platform mapping
-- conflict verbatim as per-platform overrides and listed them for owner review. The owner
-- reviewed the table the same day and approved standardizing the FILTER-BLOCKING rows
-- ("fix any location, property-type, category, or deal mapping conflict that prevents listings
-- from matching the filters"; item 8 — mustqr صالة/محطة — explicitly unchanged). The code side
-- ships on branch fix/mapping-standardization; THIS script repairs the rows already stored under
-- the old mappings, and ONLY where the raw source value is stored in the row itself and proves
-- the new mapping applies (price-repair standard: no proof → no touch).
--
-- WHAT SELF-HEALS WITHOUT THIS SCRIPT: every platform here is on a daily crawl whose upsert
-- rewrites property_type/city on re-scrape, so ACTIVE rows converge on their own within ~1 crawl
-- cycle. This script exists to (a) fix them NOW rather than eventually, (b) fix rows a crawl no
-- longer revisits (sold-pinned/inactive), and (c) update the search index for the type
-- repairs, which do NOT re-sync automatically (see the index note at the bottom).
-- NOT REPAIRED (no per-row proof stored): mustqr's 187 Villa rows (its source_capture stores
-- article text, not the API type field — the 6 rows whose free text mentions دوبلكس are NOT
-- proof the type field said so); 18 eastabha 'Land' rows whose stored category array carries no
-- أرض-family term (11 with no array at all, 7 with only ["إيجار"]). All of these are active and
-- self-heal on their next crawl where applicable.
--
-- EXPECTED COUNTS (verified against production 2026-07-16, exact ids enumerated below):
--   eastabha_residential_listings : 46 rows  property_type 'Land' → 'Residential Land'
--                                            (44 active + 2 inactive: 595508, 1038113)
--   eastabha_residential_listings :  4 rows  city 'Bish' → 'Baysh' (3), 'Tathleeth' → 'Tathlith' (1)
--   wasalt_residential_listings   : 10 rows  city unfolds: 'Khamis Mushait' → 'Sarat Abidah' (2),
--                                            'Al Baha' → 'Baljurashi' (6), 'Al Baha' → 'Al Aqiq' (2)
--   wasalt_residential_listings   :  5 rows  type: 'Villa' → 'Duplex' (4), 'Apartment' → 'Studio' (1)
--   aldarim_residential_listings  :  2 rows  type: 'Villa' → 'Duplex'
--   search_listings_ar            : ≤53 rows type_ar refresh for the type repairs (46+5+2; inactive
--                                            source rows are not in the index, so the real number is 51)
--   (No eastabha أرض زراعية→Farm rows exist: the only occurrence, id 595464, lists أرض FIRST in its
--    category array, and the scraper's first-match scan makes that row Residential Land — verified.)
--
-- PER-ROW PROOF COLUMNS (raw source value stored in the row itself):
--   eastabha type : additional_info->'property_category_ar' carries the raw WP category terms.
--   eastabha city : additional_info->>'city_ar' carries the raw Arabic city term (بيش / تثليث).
--   wasalt city   : native city_ar column (Arabic-page enrichment) carries the precise town.
--   wasalt type   : ar_data->'propertyInfo'->>'propertySubType' carries the Arabic subtype
--                   (دوبلكس / شقَّة صغيرة (استوديو)) captured from the live Arabic page.
--   aldarim type  : source_capture->>'type' carries the raw API type ('duplex').
-- Every UPDATE below re-asserts BOTH the current (wrong) value and the proof in its WHERE clause,
-- so a re-run, a concurrently re-scraped row, or a transcription slip becomes a 0-row no-op
-- instead of a wrong write. Verify blocks state the exact expected row counts.
--
-- DRY-RUN PROVEN 2026-07-16: every UPDATE below was executed against live production inside
-- BEGIN…ROLLBACK (read-only session, nothing committed) and returned EXACTLY the expected count:
-- 25 / 21 (eastabha type), 3 / 1 (eastabha city), 2 / 6 / 2 (wasalt city), 4 / 1 (wasalt type),
-- 2 (aldarim type), and 44 / 4 / 1 / 2 (search_listings_ar type_ar). If a count differs at
-- execution time, a crawl touched the rows in between — STOP and re-derive the id lists.
--
-- FILTER IMPACT (honest scope):
--   • Villa→Duplex / Apartment→Studio: REAL filter fixes — a Duplex/Studio search could never
--     return these rows (and a Villa/Apartment search returned them wrongly).
--   • Land→Residential Land: consistency/standardization — the app's 'Residential Land' clean
--     type currently ALSO queries the legacy raw 'Land' (compat entry in CLEAN_TO_QUERY), so
--     these rows were findable; the repair removes the dependence on that legacy compat entry.
--   • City unfolds: the ARABIC search path already resolves all 12 wasalt/eastabha rows to the
--     precise towns via city_ar (verified live: index city_ar = سراة عبيدة/بلجرشي/العقيق/بيش/تثليث
--     with city_id set). The EN city column repair aligns the stored label with the catalog
--     label the rest of the fleet uses (loc_city_map keys verified 2026-07-16).
--
-- =============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- Step 0: backups — every affected row, full row image, additive (never overwrites a prior run).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eastabha_residential_listings_backup_20260716_mapstd
  (LIKE eastabha_residential_listings INCLUDING ALL);
INSERT INTO eastabha_residential_listings_backup_20260716_mapstd
SELECT * FROM eastabha_residential_listings
WHERE id IN (595320,595322,595323,595337,595338,595339,595341,595352,595356,595357,595358,595359,
             595368,595370,595372,595381,595400,595402,595403,595423,595425,595433,595438,595460,
             595464,595465,595467,595468,595475,595477,595479,595487,595503,595507,595508,595513,
             595515,595516,595519,595520,595521,595522,595524,595525,595526,595527,595528,1038113)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS wasalt_residential_listings_backup_20260716_mapstd
  (LIKE wasalt_residential_listings INCLUDING ALL);
INSERT INTO wasalt_residential_listings_backup_20260716_mapstd
SELECT * FROM wasalt_residential_listings
WHERE id IN (446631,456862,457470,459713,461096,463246,477266,477267,477428,484948,500814,527673,
             1182738,2071894,2407285)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS aldarim_residential_listings_backup_20260716_mapstd
  (LIKE aldarim_residential_listings INCLUDING ALL);
INSERT INTO aldarim_residential_listings_backup_20260716_mapstd
SELECT * FROM aldarim_residential_listings
WHERE id IN (576313,1565555)
ON CONFLICT (id) DO NOTHING;

-- Backup verify: expect 48 / 15 / 2.
-- SELECT (SELECT count(*) FROM eastabha_residential_listings_backup_20260716_mapstd) eastabha,
--        (SELECT count(*) FROM wasalt_residential_listings_backup_20260716_mapstd)   wasalt,
--        (SELECT count(*) FROM aldarim_residential_listings_backup_20260716_mapstd)  aldarim;

-- ---------------------------------------------------------------------------------------------
-- Step 1: eastabha 'Land' → 'Residential Land' — 46 rows, split into 2 batches of ≤25.
-- Proof: the stored raw category array contains an أرض-family term whose first match under the
-- approved mapping is Residential Land (every one of the 46 arrays leads with أرض or ارض سكنية;
-- the single أرض زراعية occurrence, id 595464, sits AFTER أرض in its array — first match wins).
-- ---------------------------------------------------------------------------------------------
-- Batch 1/2 (25 rows)
UPDATE eastabha_residential_listings
SET property_type = 'Residential Land'
WHERE id IN (595320,595322,595323,595337,595338,595339,595341,595352,595356,595357,595358,595359,
             595368,595370,595372,595381,595400,595423,595425,595433,595438,595460,595464,595465,595467)
  AND property_type = 'Land'
  AND (additional_info->'property_category_ar') ?| ARRAY['أرض','ارض','أرض سكنية','ارض سكنية'];
-- expect: UPDATE 25

-- Batch 2/2 (21 rows)
UPDATE eastabha_residential_listings
SET property_type = 'Residential Land'
WHERE id IN (595468,595475,595477,595479,595487,595503,595507,595508,595513,595515,595516,595519,
             595520,595521,595522,595524,595525,595526,595527,595528,1038113)
  AND property_type = 'Land'
  AND (additional_info->'property_category_ar') ?| ARRAY['أرض','ارض','أرض سكنية','ارض سكنية'];
-- expect: UPDATE 21

-- Verify: 0 proven-Land rows left; the 18 no-proof rows (11 null-array + 7 ["إيجار"]) remain 'Land'.
-- SELECT count(*) FROM eastabha_residential_listings
--  WHERE property_type='Land'
--    AND (additional_info->'property_category_ar') ?| ARRAY['أرض','ارض','أرض سكنية','ارض سكنية'];
-- expect: 0
-- SELECT count(*) FROM eastabha_residential_listings WHERE property_type='Land';  -- expect: 18

-- ---------------------------------------------------------------------------------------------
-- Step 2: eastabha city labels → canonical fleet labels — 4 rows.
-- Proof: additional_info->>'city_ar'. Regions already correct (Jazan / Asir) — untouched.
-- ---------------------------------------------------------------------------------------------
UPDATE eastabha_residential_listings
SET city = 'Baysh'
WHERE id IN (595400,595402,595403)
  AND city = 'Bish' AND additional_info->>'city_ar' = 'بيش';
-- expect: UPDATE 3

UPDATE eastabha_residential_listings
SET city = 'Tathlith'
WHERE id = 595433
  AND city = 'Tathleeth' AND additional_info->>'city_ar' = 'تثليث';
-- expect: UPDATE 1

-- Verify: no eastabha rows left on ANY of the 10 retired labels.
-- SELECT count(*) FROM eastabha_residential_listings
--  WHERE city IN ('Tathleeth','Muhayil','Majmaah','Zulfi','Quwaiiyah','Turbah','Buqayq','Bukayriyah','Muthnib','Bish');
-- expect: 0   (eastabha_commercial_listings already has 0 — verified 2026-07-16)

-- ---------------------------------------------------------------------------------------------
-- Step 3: wasalt city unfolds — 10 rows. Proof: native city_ar (Arabic-page enrichment).
-- region column: left untouched (folded parent and precise town share the same region — Asir /
-- Al Bahah; 7 of the 10 rows have region NULL, a separate pre-existing gap outside this scope).
-- ---------------------------------------------------------------------------------------------
UPDATE wasalt_residential_listings
SET city = 'Sarat Abidah'
WHERE id IN (461096,484948)
  AND city = 'Khamis Mushait' AND city_ar = 'سراة عبيدة';
-- expect: UPDATE 2

UPDATE wasalt_residential_listings
SET city = 'Baljurashi'
WHERE id IN (446631,456862,459713,500814,1182738,2407285)
  AND city = 'Al Baha' AND city_ar = 'بلجرشي';
-- expect: UPDATE 6

UPDATE wasalt_residential_listings
SET city = 'Al Aqiq'
WHERE id IN (527673,2071894)
  AND city = 'Al Baha' AND city_ar = 'العقيق';
-- expect: UPDATE 2

-- Verify: the folds are empty; the precise towns carry the rows.
-- SELECT city, count(*) FROM wasalt_residential_listings
--  WHERE city_ar IN ('سراة عبيدة','بلجرشي','العقيق') GROUP BY 1;
-- expect: Sarat Abidah=2, Baljurashi=6, Al Aqiq=2 (and nothing under Khamis Mushait / Al Baha)

-- ---------------------------------------------------------------------------------------------
-- Step 4: wasalt type unfolds — 5 rows. Proof: ar_data->'propertyInfo'->>'propertySubType'.
--   457470 / 477266 / 477267 / 477428 : Villa,     Arabic subtype دوبلكس            → Duplex
--   463246 (WST5861541)               : Apartment, Arabic subtype شقَّة صغيرة (استوديو) → Studio
-- ---------------------------------------------------------------------------------------------
UPDATE wasalt_residential_listings
SET property_type = 'Duplex'
WHERE id IN (457470,477266,477267,477428)
  AND property_type = 'Villa'
  AND ar_data->'propertyInfo'->>'propertySubType' = 'دوبلكس';
-- expect: UPDATE 4

UPDATE wasalt_residential_listings
SET property_type = 'Studio'
WHERE id = 463246
  AND property_type = 'Apartment'
  AND ar_data->'propertyInfo'->>'propertySubType' LIKE '%استوديو%';
-- expect: UPDATE 1

-- ---------------------------------------------------------------------------------------------
-- Step 5: aldarim type unfolds — 2 rows. Proof: source_capture->>'type' = 'duplex'.
-- ---------------------------------------------------------------------------------------------
UPDATE aldarim_residential_listings
SET property_type = 'Duplex'
WHERE id IN (576313,1565555)
  AND property_type = 'Villa'
  AND lower(source_capture->>'type') = 'duplex';
-- expect: UPDATE 2

-- ---------------------------------------------------------------------------------------------
-- Step 6: search-index refresh for the TYPE repairs.
-- sync_search_listings_ar() (hourly, pg_cron jobid 28) re-syncs an already-indexed row ONLY when
-- last_updated moves or a LOCATION field drifts (city_id / region_id / district_ar) — a
-- property_type-only repair changes none of those, so without this step the index would keep the
-- stale type_ar until the next real re-scrape. The city repairs need NO index statement: the
-- index's city_ar/city_id come from the native Arabic path, which already carried the precise
-- towns (verified live 2026-07-16).
-- type_ar values are the canonical type_label_ar mappings (verified live: Residential Land →
-- أرض سكنية, Duplex → دوبلكس, Studio → استوديو; all present in known_type_ar with macro
-- Residential, so category-gated searches keep reaching every row).
-- ---------------------------------------------------------------------------------------------
UPDATE search_listings_ar
SET type_ar = 'أرض سكنية'
WHERE source_table = 'eastabha_residential_listings'
  AND listing_id IN (595320,595322,595323,595337,595338,595339,595341,595352,595356,595357,595358,
                     595359,595368,595370,595372,595381,595400,595423,595425,595433,595438,595460,
                     595464,595465,595467,595468,595475,595477,595479,595487,595503,595507,595508,
                     595513,595515,595516,595519,595520,595521,595522,595524,595525,595526,595527,
                     595528,1038113)
  AND type_ar = 'أرض';
-- expect: UPDATE 44 (the 2 inactive rows are not in the index)

UPDATE search_listings_ar
SET type_ar = 'دوبلكس'
WHERE source_table = 'wasalt_residential_listings'
  AND listing_id IN (457470,477266,477267,477428)
  AND type_ar = 'فيلا';
-- expect: UPDATE 4

UPDATE search_listings_ar
SET type_ar = 'استوديو'
WHERE source_table = 'wasalt_residential_listings'
  AND listing_id = 463246
  AND type_ar = 'شقة';
-- expect: UPDATE 1

UPDATE search_listings_ar
SET type_ar = 'دوبلكس'
WHERE source_table = 'aldarim_residential_listings'
  AND listing_id IN (576313,1565555)
  AND type_ar = 'فيلا';
-- expect: UPDATE 2

-- Verify (index side): the repaired ids now carry the new type_ar.
-- SELECT type_ar, count(*) FROM search_listings_ar
--  WHERE (source_table='wasalt_residential_listings'  AND listing_id IN (457470,477266,477267,477428,463246))
--     OR (source_table='aldarim_residential_listings' AND listing_id IN (576313,1565555))
--  GROUP BY 1;
-- expect: دوبلكس=6, استوديو=1

COMMIT;

-- =============================================================================================
-- OPTIONAL FOLLOW-UP (separate owner decision — NOT part of the approved repair, do not run
-- with the block above): loc_city_map has no 'sarat abidah' / 'baljurashi' keys ('al aqiq'
-- exists), so the English-overlay FALLBACK resolver (resolve_english_city_overlay, hourly)
-- cannot resolve a future Sarat Abidah/Baljurashi row whose Arabic city_ar is still NULL
-- (e.g. a wasalt row before its Arabic enrichment lands). The primary native path is proven
-- working, so nothing is broken today; these two rows would close the fallback gap:
--   INSERT INTO loc_city_map (city_key, city_ar, region_ar) VALUES
--     ('sarat abidah', 'سراة عبيدة', 'منطقة عسير'),
--     ('baljurashi',   'بلجرشي',     'منطقة الباحة')
--   ON CONFLICT DO NOTHING;
-- (Both Arabic names are globally unique in loc_catalog_city — count(city_norm)=1 verified
-- 2026-07-16 — so they pass the overlay's ambiguity gate, unlike e.g. العقيق which is 4-way
-- ambiguous and correctly stays on the native path.)
-- =============================================================================================
