-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Recover Aqar property_age that the ingest parser silently discarded (owner-approved 2026-07-17).
--
-- ROOT CAUSE: scrapers/aqar/enrich_residential.py read «عمر العقار» with `_int_after_label`, whose
-- regex `عمر\s*العقار[\s:]*?(\d+)` can only match a LATIN DIGIT. Aqar's dropdown publishes three
-- NON-numeric values — «جديد», «سنتين», «أكثر من 10 سنوات» — so they were unparseable BY CONSTRUCTION
-- and became NULL. This was never a data-availability problem: the values are sitting in our own
-- source_capture->>'source_text', already scraped, already stored. (Parser fixed in the same PR, so
-- new scrapes stop losing them; this migration recovers the rows already captured — no re-scrape.)
--
-- SAFETY, in order of importance:
--  1. NULL-ONLY. `WHERE property_age IS NULL` — this migration can never overwrite an existing value.
--     That matters: 462 live rows hold an age parsed from the SELLER'S DESCRIPTION that legitimately
--     disagrees with the dropdown (e.g. description «عمر العقار 27 سنه» vs dropdown «أكثر من 10 سنوات»).
--     The seller's 27 is MORE precise than the dropdown's bound, so those rows must keep what they have.
--  2. ANCHORED to the «تفاصيل الإعلان» structured block. Everything before that heading is nav,
--     breadcrumbs, price and free text; an unanchored read hits the description. Verified: within the
--     block the label appears exactly ONCE on 100% of target rows (0 ambiguous).
--  3. CLOSED VOCABULARY. Only the exact terms below map. Anything else stays NULL — measured: 0
--     unmapped tokens across all target rows.
--  4. OPEN-ENDED -> FLOOR. «أكثر من 10 سنوات» -> 10, never an invented midpoint (owner decision
--     2026-07-17; the legacy wasalt ladder's "10+ years"->12 fabricates precision and is being retired).
--
-- VALIDATED BEFORE WRITING (dry run against the CONTROL GROUP — rows whose column is already set):
--   the same extraction reproduces 9,099 existing values EXACTLY; all 462 disagreements are explained
--   by description-vs-dropdown (0 unexplained), and are untouched by the NULL-only guard.
-- EXPECTED EFFECT: +27,126 active rows gain a source-faithful age (0 -> 19,189 «جديد»; 10 -> 6,425
--   «أكثر من 10 سنوات»; 2 -> 1,512 «سنتين»). Coverage 17.84% -> ~43%.
--   Downstream is automatic: listing_extra_attrs -> v1/v2 -> sync_search_listings_ar (hourly job 28).
--   The «جديد» bucket in the app WILL grow substantially. That is the recovery working, not a bug.

BEGIN;

-- Backup of every row we are about to touch, so the change is reversible row-by-row with proof.
CREATE TABLE IF NOT EXISTS aqar_property_age_backfill_20260717 (
  source_table  text        NOT NULL,
  listing_id    bigint      NOT NULL,
  age_before    smallint,               -- always NULL by construction; kept explicit for auditability
  age_after     smallint    NOT NULL,
  raw_token     text        NOT NULL,   -- per-row SOURCE PROOF: the exact text the value came from
  backfilled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, listing_id)
);

CREATE OR REPLACE FUNCTION public._aqar_age_from_capture(p_source_text text)
RETURNS TABLE(raw_token text, age smallint)
LANGUAGE sql IMMUTABLE AS $fn$
  WITH blk AS (
    SELECT CASE WHEN position('تفاصيل الإعلان' in coalesce(p_source_text,'')) > 0
                THEN substring(p_source_text from position('تفاصيل الإعلان' in p_source_text))
           END AS b
  ), tok AS (
    SELECT btrim((regexp_match(b, 'عمر\s*العقار[\s:]*([^\n]{0,24})'))[1]) AS t,
           (SELECT count(*) FROM regexp_matches(b, 'عمر\s*العقار', 'g')) AS hits
    FROM blk WHERE b IS NOT NULL
  )
  SELECT t,
         (CASE
            WHEN t ~ '^جديد'                              THEN 0
            WHEN t ~ '^سنتين'                             THEN 2
            WHEN t ~ '^(أكثر|اكثر) من 10'                 THEN 10   -- bucket FLOOR, never a midpoint
            WHEN t ~ '^(أكثر|اكثر) من عشر'                THEN 10
            WHEN t ~ '^[0-9]+' AND
                 (regexp_match(t,'^([0-9]+)'))[1]::int BETWEEN 0 AND 100
                                                          THEN (regexp_match(t,'^([0-9]+)'))[1]::int
          END)::smallint
  FROM tok
  WHERE t IS NOT NULL AND hits = 1;   -- exactly one label in the block, or we do not guess
$fn$;

-- ── residential ──────────────────────────────────────────────────────────────────────────────────
WITH cand AS (
  SELECT l.id, x.raw_token, x.age
  FROM aqar_residential_listings l
  CROSS JOIN LATERAL public._aqar_age_from_capture(l.source_capture->>'source_text') x
  WHERE l.property_age IS NULL AND x.age IS NOT NULL
), ins AS (
  INSERT INTO aqar_property_age_backfill_20260717 (source_table, listing_id, age_before, age_after, raw_token)
  SELECT 'aqar_residential_listings', id, NULL, age, raw_token FROM cand
  ON CONFLICT (source_table, listing_id) DO NOTHING
  RETURNING listing_id
)
UPDATE aqar_residential_listings t
SET property_age = c.age
FROM cand c
WHERE t.id = c.id AND t.property_age IS NULL;   -- re-assert the guard at write time

-- ── commercial ───────────────────────────────────────────────────────────────────────────────────
WITH cand AS (
  SELECT l.id, x.raw_token, x.age
  FROM aqar_commercial_listings l
  CROSS JOIN LATERAL public._aqar_age_from_capture(l.source_capture->>'source_text') x
  WHERE l.property_age IS NULL AND x.age IS NOT NULL
), ins AS (
  INSERT INTO aqar_property_age_backfill_20260717 (source_table, listing_id, age_before, age_after, raw_token)
  SELECT 'aqar_commercial_listings', id, NULL, age, raw_token FROM cand
  ON CONFLICT (source_table, listing_id) DO NOTHING
  RETURNING listing_id
)
UPDATE aqar_commercial_listings t
SET property_age = c.age
FROM cand c
WHERE t.id = c.id AND t.property_age IS NULL;

-- Tripwire: every backfilled value must be inside the 5 approved buckets' input range. If the
-- extraction ever produced a build year or junk, this aborts the whole migration.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM aqar_property_age_backfill_20260717
  WHERE age_after IS NULL OR age_after < 0 OR age_after > 100;
  IF bad > 0 THEN
    RAISE EXCEPTION 'REFUSING: % backfilled rows are outside a plausible age range', bad;
  END IF;
END $$;

DROP FUNCTION public._aqar_age_from_capture(text);

COMMIT;

-- ROLLBACK (per-row, using the stored proof):
--   UPDATE aqar_residential_listings t SET property_age = b.age_before
--   FROM aqar_property_age_backfill_20260717 b
--   WHERE b.source_table = 'aqar_residential_listings' AND t.id = b.listing_id;
--   (repeat for aqar_commercial_listings)
