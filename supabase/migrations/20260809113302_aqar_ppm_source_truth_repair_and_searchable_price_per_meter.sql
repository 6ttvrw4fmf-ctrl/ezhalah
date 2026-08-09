-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- price_per_meter: make the STORED value source-truth, then carry it into the searchable index
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2026-08-09. Owner instruction: "preserve the source exactly. If Aqar only publishes price per m²,
-- store price_per_meter through the searchable backend architecture and display it clearly as
-- ريال/م². NEVER calculate or invent a total price. Make it searchable/filter-safe without
-- confusing price-per-meter with total price."
--
-- ── WHY A DATA REPAIR HAS TO COME FIRST ────────────────────────────────────────────────────────
-- Migration 20260726110014 (aqar_stop_deriving_price_per_meter) removed the WRITER that derived
-- price_per_meter as round(price_total/area_m2), and backfilled the 1,077 rows whose published rate
-- had been nulled. It did NOT purge the values the old writer had already stored. Those survive:
--
--   Evidence census over the 30,420 ACTIVE aqar rows holding a non-null price_per_meter,
--   classified by the captured page text — this codebase's existing authority for the question
--   (the same predicate mon_detect_price_fidelity() and the 07-26 backfill both use):
--     16,131  source publishes «سعر المتر» and the stored value MATCHES it        → already correct
--        882  source publishes «سعر المتر» and the stored value CONTRADICTS it    → correct to source
--     13,052  capture present, source prints NO «سعر المتر» at all                → not a source value
--              (10,296 of these — 79% — are exactly round(price_total/area_m2), the derivation
--               signature 20260726110014 named; leftovers of that removed writer)
--        337  no capture at all, so zero evidence the source published anything   → not a source value
--              (305 of these — 90.5% — hold a number exactly equal to area_m2)
--         18  «سعر المتر» IS present but the parser cannot read it                → LEFT UNTOUCHED
--
-- User-visible TODAY, not theoretical. ResultCard.tsx renders the stored price_per_meter whenever a
-- listing has no total/annual price. Verified live through the anon key on 2026-08-09:
--   id 10383  price_total NULL, price_annual NULL, price_per_meter 750, area_m2 750  (Riyadh)
--   id 17315  price_total NULL, price_annual NULL, price_per_meter 250, area_m2 250  (Jeddah)
--   id 41753  price_total NULL, price_annual NULL, price_per_meter 864, area_m2 864  (Riyadh)
-- All three have source_capture->>'source_text' = NULL — the card was printing «سعر المتر» for a
-- rate no capture ever recorded, and the number it printed was the property's AREA. Making that
-- column searchable without repairing it first would promote fabricated values into search results.
--
-- ── THE REPAIR (evidence only; nothing computed from price or area) ─────────────────────────────
--   A. «سعر المتر» present AND parseable  → price_per_meter := the published value
--   B. capture present, no «سعر المتر»    → price_per_meter := NULL
--   C. no capture at all                  → price_per_meter := NULL
--   D. «سعر المتر» present, unparseable   → UNTOUCHED. A parser gap must never destroy a value the
--                                           source demonstrably does print.
-- Nothing derives a rate, and nothing anywhere derives a total FROM a rate — that stays forbidden.
-- Every changed row is recorded in ops_bk_aqar_ppm_20260809 with its prior value, so the data half
-- of this migration is exactly reversible.
-- NOTE: rule C did not fire here — see the same-day follow-up 20260809113548, which fixes a
-- three-valued-logic bug in the rule-D guard below (`st LIKE ...` is NULL when st IS NULL, so
-- `NOT (NULL AND true)` is NULL, not TRUE, and the no-capture rows were filtered out).
--
-- ── THEN: carry it into the searchable index ───────────────────────────────────────────────────
-- listing_native_location_v2 ALREADY exposes price_per_meter, so the index needs only the column
-- plus four additions to sync_search_listings_ar. FILTER SAFETY: price_per_meter lives in its OWN
-- column and is never read by any price filter — location_search_candidates_ar's p_price_min /
-- p_price_max compare against price_total / price_annual only, and are untouched here. A per-meter
-- rate can therefore never be matched against a total-price filter.
-- Guarded by scripts/verify-ppm-searchable-and-filter-safe.ts (in `npm test`).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. rollback ledger (prior value captured BEFORE any write) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ops_bk_aqar_ppm_20260809 (
  src_table  text   NOT NULL,
  id         bigint NOT NULL,
  old_ppm    integer,
  new_ppm    integer,
  reason     text   NOT NULL,
  PRIMARY KEY (src_table, id)
);

-- ── 2. repair: aqar_residential_listings ───────────────────────────────────────────────────────
WITH ev AS (
  SELECT id, price_per_meter AS old_ppm,
         source_capture->>'source_text' AS st,
         public.aqar_published_ppm(source_capture->>'source_text') AS pub
  FROM public.aqar_residential_listings
  WHERE price_per_meter IS NOT NULL
), plan AS (
  SELECT id, old_ppm,
         CASE WHEN st LIKE '%سعر المتر%' AND pub IS NOT NULL THEN pub::integer
              WHEN st IS NULL                                THEN NULL
              WHEN st NOT LIKE '%سعر المتر%'                  THEN NULL
         END AS new_ppm,
         CASE WHEN st LIKE '%سعر المتر%' AND pub IS NOT NULL THEN 'corrected_to_published'
              WHEN st IS NULL                                THEN 'null_no_capture'
              ELSE                                                'null_source_prints_no_rate'
         END AS reason
  FROM ev
  WHERE NOT (st LIKE '%سعر المتر%' AND pub IS NULL)          -- rule D: parser gap → untouched
), chg AS (
  SELECT * FROM plan WHERE new_ppm IS DISTINCT FROM old_ppm
), ins AS (
  INSERT INTO public.ops_bk_aqar_ppm_20260809 (src_table, id, old_ppm, new_ppm, reason)
  SELECT 'aqar_residential_listings', id, old_ppm, new_ppm, reason FROM chg
  ON CONFLICT DO NOTHING RETURNING 1
)
UPDATE public.aqar_residential_listings t
   SET price_per_meter = chg.new_ppm
  FROM chg WHERE t.id = chg.id;

-- ── 3. repair: aqar_commercial_listings (identical rules) ──────────────────────────────────────
WITH ev AS (
  SELECT id, price_per_meter AS old_ppm,
         source_capture->>'source_text' AS st,
         public.aqar_published_ppm(source_capture->>'source_text') AS pub
  FROM public.aqar_commercial_listings
  WHERE price_per_meter IS NOT NULL
), plan AS (
  SELECT id, old_ppm,
         CASE WHEN st LIKE '%سعر المتر%' AND pub IS NOT NULL THEN pub::integer
              WHEN st IS NULL                                THEN NULL
              WHEN st NOT LIKE '%سعر المتر%'                  THEN NULL
         END AS new_ppm,
         CASE WHEN st LIKE '%سعر المتر%' AND pub IS NOT NULL THEN 'corrected_to_published'
              WHEN st IS NULL                                THEN 'null_no_capture'
              ELSE                                                'null_source_prints_no_rate'
         END AS reason
  FROM ev
  WHERE NOT (st LIKE '%سعر المتر%' AND pub IS NULL)
), chg AS (
  SELECT * FROM plan WHERE new_ppm IS DISTINCT FROM old_ppm
), ins AS (
  INSERT INTO public.ops_bk_aqar_ppm_20260809 (src_table, id, old_ppm, new_ppm, reason)
  SELECT 'aqar_commercial_listings', id, old_ppm, new_ppm, reason FROM chg
  ON CONFLICT DO NOTHING RETURNING 1
)
UPDATE public.aqar_commercial_listings t
   SET price_per_meter = chg.new_ppm
  FROM chg WHERE t.id = chg.id;

-- ── 4. the searchable column ───────────────────────────────────────────────────────────────────
ALTER TABLE public.search_listings_ar ADD COLUMN IF NOT EXISTS price_per_meter integer;

COMMENT ON COLUMN public.search_listings_ar.price_per_meter IS
  'SOURCE-PUBLISHED «سعر المتر» only, carried verbatim from listing_native_location_v2. NEVER '
  'derived from price_total/area_m2, and NEVER used to derive a total. This is a per-square-metre '
  'RATE, not a price: the p_price_min/p_price_max filters read price_total/price_annual only and '
  'must never read this column. See scripts/verify-ppm-searchable-and-filter-safe.ts.';

-- ── 5. teach sync_search_listings_ar to carry it ───────────────────────────────────────────────
-- Needle-edited from pg_get_functiondef of the LIVE function (never retyped by hand — the
-- full-body-replace revert hazard), with each edit asserted so a silent no-op cannot ship.
-- Signature unchanged, so CREATE OR REPLACE mints no new overload.
DO $do$
DECLARE src text; out text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='sync_search_listings_ar';
  IF src IS NULL THEN RAISE EXCEPTION 'sync_search_listings_ar not found'; END IF;
  out := src;

  -- (a) INSERT column list
  out := replace(out,
    'private_entrance, production_ready)',
    'private_entrance, production_ready, price_per_meter)');
  IF out = src THEN RAISE EXCEPTION 'ppm edit (a) INSERT column list did not match'; END IF;

  -- (b) SELECT list — anchored on the FROM that follows it
  IF position('v.production_ready' in out) = 0 THEN
    RAISE EXCEPTION 'ppm edit (b) anchor v.production_ready not found';
  END IF;
  out := regexp_replace(out,
    'v\.production_ready(\s+)from listing_native_location_v2 v',
    'v.production_ready, v.price_per_meter\1from listing_native_location_v2 v');
  IF position('v.price_per_meter' in out) = 0 THEN
    RAISE EXCEPTION 'ppm edit (b) SELECT list did not match';
  END IF;

  -- (c) change-detection predicate: a ppm-only change must still trigger a re-sync
  out := replace(out,
    's3.private_entrance is distinct from v.private_entrance',
    's3.private_entrance is distinct from v.private_entrance
                       or s3.price_per_meter is distinct from v.price_per_meter');
  IF position('s3.price_per_meter' in out) = 0 THEN
    RAISE EXCEPTION 'ppm edit (c) change-detection did not match';
  END IF;

  -- (d) ON CONFLICT DO UPDATE SET
  out := replace(out,
    'production_ready=excluded.production_ready;',
    'production_ready=excluded.production_ready, price_per_meter=excluded.price_per_meter;');
  IF position('price_per_meter=excluded.price_per_meter' in out) = 0 THEN
    RAISE EXCEPTION 'ppm edit (d) ON CONFLICT SET did not match';
  END IF;

  EXECUTE out;
END
$do$;

-- ── 6. backfill the new column for rows already in the index ───────────────────────────────────
-- Reads the repaired v2 value verbatim. Rows whose source publishes no rate stay NULL.
-- NB: v2 reads its price columns from the active_listing_ids_v2 MATVIEW, so a REFRESH is required
-- for a source-table repair to reach v2 (done after the follow-up migration; see report).
UPDATE public.search_listings_ar s
   SET price_per_meter = v.price_per_meter
  FROM public.listing_native_location_v2 v
 WHERE v.source_table = s.source_table
   AND v.listing_id  = s.listing_id
   AND s.price_per_meter IS DISTINCT FROM v.price_per_meter;

-- ── 7. index for the searchable/filterable rate ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_sla_price_per_meter
  ON public.search_listings_ar (price_per_meter)
  WHERE price_per_meter IS NOT NULL;
