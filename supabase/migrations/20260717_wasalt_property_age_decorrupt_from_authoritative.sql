-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- De-corrupt wasalt.property_age: rewrite the canonical column from the AUTHORITATIVE detail-page
-- string (owner-approved 2026-07-17). Pairs with the scraper fix in the same PR (run.py stops writing
-- the corrupt enum; enrich.py now derives the column via normalize.parse_property_age).
--
-- ROOT CAUSE: scrapers/wasalt/run.py wrote the SEARCH-LIST API's `completionYear`, a 1-based-ish ENUM
-- offset from true years, into the smallint column. Measured live: "New" -> 1 (should be 0),
-- "10+ years" -> 12, and 20,956/25,864 comparable rows off by +1 including 17,869 "New" recorded as 1.
-- The AUTHORITATIVE value is the human string on the detail page, stored in additional_info
-- (completionYear), which listing_extra_attrs already reads for search.
--
-- ZERO SEARCH IMPACT: the live search view reads the JSONB string, NOT this column, so search age is
-- already correct and does not change here. This migration only makes the RAW COLUMN trustworthy so the
-- future generic (registry-driven) age producer can rely on the house convention instead of treating
-- wasalt as a special JSONB exception. (See the permanent architecture rule.)
--
-- SAFETY:
--  * OVERWRITE (not NULL-only) — the existing values are provably wrong, so every touched row is backed
--    up (old value + the exact authoritative source string) for per-row rollback.
--  * The mapping mirrors normalize.parse_property_age EXACTLY: closed English/Arabic vocabulary +
--    leading-number; open-ended buckets ("10+ years" / «أكثر من 10 سنوات») -> FLOOR 10, never a midpoint;
--    anything unmapped -> NULL (honest unknown, never a guess). Dry run: 0 values out of range, 0
--    unmapped-non-null.
--  * Scoped to ACTIVE rows (the search-relevant set). Inactive rows self-heal via the fixed scraper on
--    re-enrichment.
--  * Tripwire aborts the whole migration if any written value is implausible.

CREATE TABLE IF NOT EXISTS wasalt_property_age_decorrupt_20260717 (
  source_table  text        NOT NULL,
  listing_id    bigint      NOT NULL,
  age_before    smallint,               -- the corrupt enum value being replaced
  age_after     smallint,               -- authoritative (may be NULL = honest unknown)
  source_string text,                   -- per-row PROOF: the completionYear string it was derived from
  rewritten_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, listing_id)
);

-- Shared mapping = normalize.parse_property_age in SQL form (English + Arabic closed vocab + leading n).
CREATE OR REPLACE FUNCTION public._wasalt_age_from_completionyear(cy text)
RETURNS smallint LANGUAGE sql IMMUTABLE AS $fn$
  SELECT (CASE
    WHEN cy IS NULL THEN NULL
    WHEN lower(btrim(cy)) IN ('new','<1 year','less than 1 year','under 1 year') THEN 0
    WHEN btrim(cy) IN ('جديد') THEN 0
    WHEN lower(btrim(cy)) IN ('10+ years','more than 10 years')
      OR btrim(cy) IN ('أكثر من 10 سنوات','اكثر من 10 سنوات','اكثر من عشر سنوات','أكثر من عشر سنوات') THEN 10
    WHEN btrim(cy) ~ '^[0-9]+'
      AND (regexp_match(btrim(cy),'^([0-9]+)'))[1]::int BETWEEN 0 AND 100
      THEN (regexp_match(btrim(cy),'^([0-9]+)'))[1]::int
    ELSE NULL
  END)::smallint;
$fn$;

-- ── residential + commercial ───────────────────────────────────────────────────────────────────────
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['wasalt_residential_listings','wasalt_commercial_listings'] LOOP
    EXECUTE format($q$
      WITH src AS (
        SELECT id, property_age AS old_age,
          btrim((SELECT e->>'value' FROM jsonb_array_elements(additional_info) e
                 WHERE e->>'key'='completionYear' LIMIT 1)) AS cy
        FROM %1$I
        WHERE active AND jsonb_typeof(additional_info) = 'array'
      ), m AS (
        SELECT id, old_age, cy, public._wasalt_age_from_completionyear(cy) AS new_age FROM src
      ), bk AS (
        INSERT INTO wasalt_property_age_decorrupt_20260717 (source_table, listing_id, age_before, age_after, source_string)
        SELECT %1$L, id, old_age, new_age, cy FROM m
        WHERE old_age IS DISTINCT FROM new_age
        ON CONFLICT (source_table, listing_id) DO NOTHING
        RETURNING 1
      )
      UPDATE %1$I t SET property_age = m.new_age
      FROM m WHERE t.id = m.id AND t.property_age IS DISTINCT FROM m.new_age
    $q$, tbl);
  END LOOP;
END $$;

-- Tripwire: nothing implausible may have been written.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM wasalt_property_age_decorrupt_20260717
  WHERE age_after IS NOT NULL AND (age_after < 0 OR age_after > 100);
  IF bad > 0 THEN RAISE EXCEPTION 'REFUSING: % rewritten wasalt rows are implausible', bad; END IF;
END $$;

DROP FUNCTION public._wasalt_age_from_completionyear(text);

-- ROLLBACK (per-row, from the backup):
--   UPDATE wasalt_residential_listings t SET property_age = b.age_before
--   FROM wasalt_property_age_decorrupt_20260717 b
--   WHERE b.source_table='wasalt_residential_listings' AND t.id=b.listing_id;
--   (repeat for wasalt_commercial_listings)
