-- =============================================================================================
-- Aqar comma-truncated area repair — 2026-07-17 (STAGED, NOT EXECUTED)
-- =============================================================================================
-- DO NOT EXECUTE AGAINST PRODUCTION WITHOUT OWNER SIGN-OFF. Prepared, reviewed artifact only
-- (project rules: Approval-workflow-rule / Price-fidelity + price-repair standard — backup first,
-- per-row verbatim source proof, exact-id batches ≤ 25, post-verify after every batch).
--
-- ROOT CAUSE (fixed in this same branch, scrapers/aqar/enrich_residential.py::_int_after_label):
--   the label-number capture `(\d+)` stopped at the FIRST thousands separator, so a comma-grouped
--   value was stored as its leading group only —
--     ad 6693642  "المساحة 717,928 م²"  → stored area_m2 = 717      (true 717,928)
--     ad 6708090  "المساحة 739,100 م²"  → stored area_m2 = 739      (true 739,100)
--     ad 6658941  "المساحة: ١٨٬٨٣٧٫١٩ م²" → stored area_m2 = 18     (Arabic ٬ U+066C grouping)
--   DOWNSTREAM POISON: trg_aqar_parse (BEFORE trigger on both aqar tables) recomputes Buy
--   price_per_meter as round(price_total / NEW.area_m2). area_m2 is owned by the Python enricher
--   (the trigger never sets it), so the truncated area inflated stored ppm by the truncation
--   factor — live examples: 6693642 ppm=1001 §/m² (page's own سعر المتر = 1 §), 6619564
--   ppm=600,520 §/m² (600,520 § / "1" m²), 6702641 ppm=12,375,000 §/m².
--   DB-SIDE PARSER IS NOT AFFECTED: public.aqar_parse() already consumes '\d[\d,]*' and strips
--   commas for area/deed_area/views/prices (verified live 2026-07-17: aqar_parse of both exemplar
--   source_texts returns 717928 / 739100) — no trigger migration is needed; this is purely a
--   stored-data repair plus the Python fix.
--
-- REPAIR PRINCIPLE (price/data-fidelity): every corrected value below is extracted from the row's
-- OWN source_capture->>'source_text' — the verbatim capture of the source page — by the exact
-- parse the fixed Python code performs (strict thousands grouping: 1-3 digits then [,٬]-separated
-- 3-digit groups; Arabic-Indic digits and ٬/٫ translated 1:1 first). Nothing is estimated,
-- rounded, or inferred: a row is a candidate ONLY if its own source text contains a
-- thousands-grouped number right after the area label AND the stored value differs from that
-- number. The verbatim evidence snippet is stored per row in the backup table.
--
-- QUANTIFICATION (read-only, live, 2026-07-17):
--   aqar_residential_listings  area_m2 mismatch: 2,982 active + 89 inactive = 3,071
--                                (of which Buy w/ price_total → ppm also poisoned: 2,119 + 83)
--                              interior_space_m2 mismatch: 6 active
--   aqar_commercial_listings   area_m2 mismatch: 1,596 active + 48 inactive = 1,644
--                                (of which Buy w/ price_total → ppm poisoned: 207 + 5)
--                              interior_space_m2 mismatch: 2 active
--   TOTAL repair candidates: 4,723 rows → 189 exact-id batches of ≤ 25.
--   outdoor_area_m2: 0 comma-grouped rows live — nothing to repair.
--
-- SEARCH-INDEX IMPACT: area_m2 IS served from search_listings_ar (both aqar source tables feed
-- it; listing_id = base-table id). VERIFIED against the LIVE definition of
-- public.sync_search_listings_ar() on 2026-07-17: its upsert candidate set explicitly includes
-- the attribute-drift arm  `... or exists (select 1 from search_listings_ar s3 where ... and
-- (s3.area_m2 is distinct from v.area_m2 or ...))`  — i.e. rows whose base area_m2 changes are
-- re-upserted on the next sync run even though last_updated does not advance. So no manual index
-- touch is required: run (or wait for) sync_search_listings_ar() after the batches and verify
-- with the query in Step 3c.
--
-- TRIGGER INTERACTION (rehearsed under BEGIN/ROLLBACK 2026-07-17, see branch notes): updating
-- area_m2/price_per_meter WITHOUT touching source_capture on a fullparse_done row short-circuits
-- trg_aqar_parse (`NEW.source_capture is not distinct from OLD.source_capture and
-- NEW.fullparse_done → return NEW`), so the repaired values land exactly as written. On the few
-- rows with fullparse_done=false the trigger re-parses the same source_text and recomputes ppm
-- from the repaired area — the identical value this script sets. Either path is safe.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- Step 1: backup EVERY candidate row BEFORE anything is touched — old value, new value, and the
-- row's own verbatim source evidence. Additive create-if-not-exists; never overwrites a prior
-- run. batch_no freezes the exact id membership of every ≤25-row batch at staging time.
-- ---------------------------------------------------------------------------------------------
BEGIN;

CREATE TABLE IF NOT EXISTS ops_area_repair_backup_20260717 (
  source_table   text        NOT NULL,           -- aqar_residential_listings | aqar_commercial_listings
  id             bigint      NOT NULL,           -- base-table PK (= search_listings_ar.listing_id)
  ad_number      text        NOT NULL,
  listing_url    text,
  active         boolean,
  transaction_type text,
  field          text        NOT NULL,           -- 'area_m2' | 'interior_space_m2'
  old_value      bigint,                         -- stored (truncated) value at staging time
  new_value      bigint      NOT NULL,           -- comma-stripped value from the row's own source_text
  old_ppm        integer,                        -- stored price_per_meter at staging time (area rows)
  new_ppm        integer,                        -- round(price_total/new_value), Buy w/ price_total only
  price_total    bigint,
  source_token   text        NOT NULL,           -- the grouped token as parsed (translated digits)
  source_evidence text       NOT NULL,           -- VERBATIM snippet from source_capture->>'source_text'
  batch_no       integer     NOT NULL,           -- ≤25 rows per batch, frozen at staging time
  staged_at      timestamptz NOT NULL DEFAULT now(),
  repaired_at    timestamptz,                    -- set by Step 2 as each batch lands
  PRIMARY KEY (source_table, id, field)
);

WITH base AS (
  SELECT 'aqar_residential_listings'::text AS source_table, id, ad_number, listing_url, active,
         transaction_type, area_m2, interior_space_m2, price_total, price_per_meter,
         source_capture->>'source_text' AS raw,
         translate(source_capture->>'source_text', '٠١٢٣٤٥٦٧٨٩٬٫', '0123456789,.') AS t
  FROM aqar_residential_listings WHERE source_capture->>'source_text' IS NOT NULL
  UNION ALL
  SELECT 'aqar_commercial_listings', id, ad_number, listing_url, active,
         transaction_type, area_m2, interior_space_m2, price_total, price_per_meter,
         source_capture->>'source_text',
         translate(source_capture->>'source_text', '٠١٢٣٤٥٦٧٨٩٬٫', '0123456789,.')
  FROM aqar_commercial_listings WHERE source_capture->>'source_text' IS NOT NULL
), parsed AS (
  -- EXACT replica of the fixed Python parse (labels verbatim from enrich_residential call sites;
  -- strict-group first alternative, plain \d+ fallback; leftmost whole-pattern match wins).
  SELECT *,
    (regexp_match(t, 'المساحة(?:\s*(?:الكلية|الإجمالية))?[\s:]*(\d{1,3}(?:,\d{3})+(?!\d)|\d+)'))[1] AS area_tok,
    COALESCE(
      (regexp_match(t, 'المساحة\s*الداخلية[\s:]*(\d{1,3}(?:,\d{3})+(?!\d)|\d+)'))[1],
      (regexp_match(t, 'مساحة\s*البناء[\s:]*(\d{1,3}(?:,\d{3})+(?!\d)|\d+)'))[1]
    ) AS interior_tok
  FROM base
), cand AS (
  SELECT source_table, id, ad_number, listing_url, active, transaction_type,
         'area_m2' AS field, area_m2 AS old_value,
         replace(area_tok, ',', '')::bigint AS new_value,
         price_per_meter AS old_ppm,
         CASE WHEN transaction_type = 'Buy' AND price_total IS NOT NULL
                   AND replace(area_tok, ',', '')::bigint > 0
              THEN round(price_total::numeric / replace(area_tok, ',', '')::bigint)::int END AS new_ppm,
         price_total, area_tok AS source_token,
         substring(raw FROM '(المساحة(?:\s*(?:الكلية|الإجمالية))?[\s:]*[0-9٠-٩][0-9٠-٩,٬]*(?:[.٫][0-9٠-٩]+)?(?:\s*م²?)?)') AS source_evidence
  FROM parsed
  WHERE area_tok LIKE '%,%' AND area_m2 IS DISTINCT FROM replace(area_tok, ',', '')::bigint
  UNION ALL
  SELECT source_table, id, ad_number, listing_url, active, transaction_type,
         'interior_space_m2', interior_space_m2,
         replace(interior_tok, ',', '')::bigint,
         NULL, NULL, price_total, interior_tok,
         substring(raw FROM '((?:المساحة\s*الداخلية|مساحة\s*البناء)[\s:]*[0-9٠-٩][0-9٠-٩,٬]*(?:[.٫][0-9٠-٩]+)?(?:\s*م²?)?)')
  FROM parsed
  WHERE interior_tok LIKE '%,%' AND interior_space_m2 IS DISTINCT FROM replace(interior_tok, ',', '')::bigint
)
INSERT INTO ops_area_repair_backup_20260717
  (source_table, id, ad_number, listing_url, active, transaction_type, field,
   old_value, new_value, old_ppm, new_ppm, price_total, source_token, source_evidence, batch_no)
SELECT source_table, id, ad_number, listing_url, active, transaction_type, field,
       old_value, new_value, old_ppm, new_ppm, price_total, source_token, source_evidence,
       ((row_number() OVER (ORDER BY source_table, field, id) - 1) / 25 + 1)::int
FROM cand
ON CONFLICT (source_table, id, field) DO NOTHING;

-- Staging sanity (expected as of 2026-07-17: 4,723 rows, 189 batches, max batch size 25):
SELECT count(*) AS rows_staged, max(batch_no) AS batches,
       (SELECT max(cnt) FROM (SELECT count(*) AS cnt
                              FROM ops_area_repair_backup_20260717 GROUP BY batch_no) x) AS max_batch_size
FROM ops_area_repair_backup_20260717;

COMMIT;

-- ---------------------------------------------------------------------------------------------
-- Step 2: repair, ONE BATCH AT A TIME (≤25 rows, exact ids frozen in the backup table).
-- Replace :BATCH with 1, 2, … max(batch_no); run Step 2a+2b+2c together per batch and eyeball 2c
-- before moving on. The guard `old_value` / `old_ppm` makes every statement a no-op on any row
-- that changed since staging (e.g. a fresh scrape already fixed it) — never clobbers newer data.
-- ---------------------------------------------------------------------------------------------
-- Step 2a — residential rows of this batch:
-- UPDATE aqar_residential_listings a
-- SET area_m2         = CASE WHEN b.field = 'area_m2'          THEN b.new_value ELSE a.area_m2 END,
--     interior_space_m2 = CASE WHEN b.field = 'interior_space_m2' THEN b.new_value ELSE a.interior_space_m2 END,
--     price_per_meter = CASE WHEN b.new_ppm IS NOT NULL        THEN b.new_ppm   ELSE a.price_per_meter END
-- FROM ops_area_repair_backup_20260717 b
-- WHERE b.source_table = 'aqar_residential_listings' AND b.batch_no = :BATCH AND b.repaired_at IS NULL
--   AND a.id = b.id
--   AND (   (b.field = 'area_m2'           AND a.area_m2           IS NOT DISTINCT FROM b.old_value)
--        OR (b.field = 'interior_space_m2' AND a.interior_space_m2 IS NOT DISTINCT FROM b.old_value));
--
-- Step 2b — commercial rows of this batch (same statement with the other table):
-- UPDATE aqar_commercial_listings a
-- SET area_m2         = CASE WHEN b.field = 'area_m2'          THEN b.new_value ELSE a.area_m2 END,
--     interior_space_m2 = CASE WHEN b.field = 'interior_space_m2' THEN b.new_value ELSE a.interior_space_m2 END,
--     price_per_meter = CASE WHEN b.new_ppm IS NOT NULL        THEN b.new_ppm   ELSE a.price_per_meter END
-- FROM ops_area_repair_backup_20260717 b
-- WHERE b.source_table = 'aqar_commercial_listings' AND b.batch_no = :BATCH AND b.repaired_at IS NULL
--   AND a.id = b.id
--   AND (   (b.field = 'area_m2'           AND a.area_m2           IS NOT DISTINCT FROM b.old_value)
--        OR (b.field = 'interior_space_m2' AND a.interior_space_m2 IS NOT DISTINCT FROM b.old_value));
--
-- Step 2c — mark + verify this batch (every row must now equal its source-proven value or have
-- been skipped by the guard; investigate any 'MISMATCH' before the next batch):
-- UPDATE ops_area_repair_backup_20260717 SET repaired_at = now()
-- WHERE batch_no = :BATCH AND repaired_at IS NULL;
--
-- SELECT b.source_table, b.ad_number, b.field, b.old_value, b.new_value, b.source_evidence,
--        CASE WHEN b.field = 'area_m2' AND coalesce(r.area_m2, c.area_m2) = b.new_value THEN 'OK'
--             WHEN b.field = 'interior_space_m2'
--                  AND coalesce(r.interior_space_m2, c.interior_space_m2) = b.new_value THEN 'OK'
--             ELSE 'MISMATCH-OR-GUARD-SKIPPED' END AS check
-- FROM ops_area_repair_backup_20260717 b
-- LEFT JOIN aqar_residential_listings r ON b.source_table = 'aqar_residential_listings' AND r.id = b.id
-- LEFT JOIN aqar_commercial_listings  c ON b.source_table = 'aqar_commercial_listings'  AND c.id = b.id
-- WHERE b.batch_no = :BATCH ORDER BY b.source_table, b.id;

-- ---------------------------------------------------------------------------------------------
-- Step 3: global post-verify (after ALL batches).
-- ---------------------------------------------------------------------------------------------
-- 3a — the quantification query must now return ZERO candidates (re-run the exact staging CTE
--      `cand` above as a SELECT count(*): expected 0 area + 0 interior per table).
--
-- 3b — exemplar spot-checks (values proven from each row's own source text):
-- SELECT ad_number, area_m2, price_total, price_per_meter FROM aqar_residential_listings
-- WHERE ad_number IN ('6693642','6708090','6658941','6658933');
--   expect: 6693642 → area 717928, ppm 1 (was 717 / 1001)
--           6708090 → area 739100, ppm 8 (was 739 / 7501; page سعر المتر 7.5, trigger rounds)
--           6658941 → area 18837 (was 18);  6658933 → area 2524 (was 2)
--
-- 3c — ppm consistency: no repaired Buy row may disagree with round(price_total/area_m2):
-- SELECT count(*) FROM aqar_residential_listings a
-- JOIN ops_area_repair_backup_20260717 b
--   ON b.source_table='aqar_residential_listings' AND b.id=a.id AND b.field='area_m2'
-- WHERE a.transaction_type='Buy' AND a.price_total IS NOT NULL AND a.area_m2 > 0
--   AND a.price_per_meter IS DISTINCT FROM round(a.price_total::numeric/a.area_m2)::int;
-- (repeat for aqar_commercial_listings) — expect 0.
--
-- 3d — search index heals via the attr-drift arm of sync_search_listings_ar() (verified live,
--      see header). Run `SELECT * FROM sync_search_listings_ar();` or wait for its schedule, then:
-- SELECT count(*) FROM search_listings_ar s
-- JOIN aqar_residential_listings a ON a.id = s.listing_id
-- WHERE s.source_table = 'aqar_residential_listings' AND s.area_m2 IS DISTINCT FROM a.area_m2;
-- SELECT count(*) FROM search_listings_ar s
-- JOIN aqar_commercial_listings a ON a.id = s.listing_id
-- WHERE s.source_table = 'aqar_commercial_listings' AND s.area_m2 IS DISTINCT FROM a.area_m2;
-- — expect 0 and 0.
-- =============================================================================================
