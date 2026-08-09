-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Follow-up to 20260809113302_aqar_ppm_source_truth_repair_and_searchable_price_per_meter.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- That migration's rule C ("no capture at all → price_per_meter := NULL") never fired: 0 rows were
-- written with reason 'null_no_capture', and 337 uncorroborated rows survived.
--
-- Cause — SQL three-valued logic in the guard implementing rule D. The guard was
--     WHERE NOT (st LIKE '%سعر المتر%' AND pub IS NULL)
-- and when st IS NULL, `st LIKE ...` evaluates to NULL, so the whole expression is
-- NULL AND true = NULL, and NOT NULL = NULL — which is not TRUE, so the row was filtered out
-- rather than kept. Exactly the rows rule C existed to catch were the rows it dropped.
--
-- These are the cohort the live evidence came from: 305 of the 337 hold a price_per_meter
-- numerically equal to area_m2 (id 10383 = 750/750, id 17315 = 250/250, id 41753 = 864/864), with
-- source_capture->>'source_text' NULL, so there is no record of the source publishing any rate.
-- Fixed here with an explicit IS NULL branch. Same ledger, same reversibility.
--
-- VERIFIED AFTER APPLYING (+ REFRESH MATERIALIZED VIEW CONCURRENTLY active_listing_ids_v2, which
-- is what carries a source-table price change into listing_native_location_v2, + re-running the
-- index backfill):
--   uncorroborated active aqar rows holding a rate ......... 0   (was 337)
--   ppm_source_dropped — published rate stored as NULL ..... 0   (07-26 guard still holds)
--   ids 10383 / 17315 / 41753 still fabricated ............. 0
--   search_listings_ar rows carrying an aqar rate ..... 17,031   (was 30,420)
--   ppm-only listings now searchable with a real rate .. 1,786
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

WITH chg AS (
  SELECT id, price_per_meter AS old_ppm
  FROM public.aqar_residential_listings
  WHERE price_per_meter IS NOT NULL
    AND source_capture->>'source_text' IS NULL
), ins AS (
  INSERT INTO public.ops_bk_aqar_ppm_20260809 (src_table, id, old_ppm, new_ppm, reason)
  SELECT 'aqar_residential_listings', id, old_ppm, NULL, 'null_no_capture' FROM chg
  ON CONFLICT DO NOTHING RETURNING 1
)
UPDATE public.aqar_residential_listings t
   SET price_per_meter = NULL
  FROM chg WHERE t.id = chg.id;

WITH chg AS (
  SELECT id, price_per_meter AS old_ppm
  FROM public.aqar_commercial_listings
  WHERE price_per_meter IS NOT NULL
    AND source_capture->>'source_text' IS NULL
), ins AS (
  INSERT INTO public.ops_bk_aqar_ppm_20260809 (src_table, id, old_ppm, new_ppm, reason)
  SELECT 'aqar_commercial_listings', id, old_ppm, NULL, 'null_no_capture' FROM chg
  ON CONFLICT DO NOTHING RETURNING 1
)
UPDATE public.aqar_commercial_listings t
   SET price_per_meter = NULL
  FROM chg WHERE t.id = chg.id;
