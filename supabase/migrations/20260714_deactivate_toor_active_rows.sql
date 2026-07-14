-- ============================================================================
-- Script (NOT APPLIED): back up + deactivate the currently-active toor rows.
-- Target: Supabase project aannarbkwcymrotzwdbo (LIVE PRODUCTION)
-- Prepared 2026-07-14. Read-only SELECTs were run live to produce the exact
-- id lists below; nothing in this file has been executed against prod.
--
-- LIVE COUNTS VERIFIED 2026-07-14 (execute_sql, read-only):
--   toor_residential_listings : 25 total rows, 23 active
--   toor_commercial_listings  :  4 total rows,  0 active  <- nothing to flip
--
-- EXACT ACTIVE toor_residential_listings IDS (23 rows, verified live via
--   `SELECT id FROM public.toor_residential_listings WHERE active = true
--    ORDER BY id;` on 2026-07-14):
--   614652, 614653, 614654, 614655, 614656, 614657, 614658, 614659, 614660,
--   614661, 614662, 614663, 614664, 615926, 615927, 615928, 615930, 615932,
--   615933, 615934, 615935, 615936, 615937
--
-- toor_commercial_listings has ZERO active rows today (4 total, all already
-- active=false) -- there is nothing to back up or deactivate on that table.
-- The script below still touches it defensively (WHERE active = true), so if
-- this file is re-run at execution time and something changed the commercial
-- table's active flags in the interim, it will pick up exactly those rows,
-- back them up, and only then flip them -- it will not silently do nothing on
-- a false assumption.
--
-- PRECEDENT / SHAPE followed: this mirrors the existing ad-hoc backup-table
-- pattern already in this DB, `ops_price_repair_backup_20260713`
-- (columns: source_table text, listing_id bigint, price_total_old bigint,
-- price_annual_old bigint, price_per_meter_old integer, rent_period_old text,
-- transaction_type_old text, active_old boolean, bug text, backed_up_at
-- timestamptz) -- adapted here to capture the FULL row (not just a few
-- columns) since a deactivation, unlike a price repair, needs to be fully
-- reversible from the backup alone. `purged_listings_archive` (the other
-- precedent mentioned in the design context) is for permanent hard-delete
-- scenarios and is NOT used here since these rows are only being deactivated,
-- not deleted.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1a) Snapshot: toor_residential_listings active rows -> full-row backup.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.toor_residential_listings_backup_20260714
  (LIKE public.toor_residential_listings INCLUDING ALL);

INSERT INTO public.toor_residential_listings_backup_20260714
SELECT * FROM public.toor_residential_listings
WHERE id IN (
  614652, 614653, 614654, 614655, 614656, 614657, 614658, 614659, 614660,
  614661, 614662, 614663, 614664, 615926, 615927, 615928, 615930, 615932,
  615933, 615934, 615935, 615936, 615937
)
AND active = true;   -- belt-and-suspenders: only ever backs up rows that are
                      -- actually still active at execution time, even though
                      -- the id list above was captured live on 2026-07-14.

-- Sanity check (fails the transaction if the live id-list assumption above no
-- longer holds -- i.e. if the active set has drifted since this file was
-- written, this ABORTs rather than silently deactivating a different set):
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.toor_residential_listings_backup_20260714;
  IF n <> 23 THEN
    RAISE EXCEPTION
      'Expected exactly 23 active toor_residential_listings rows backed up, got %. '
      'The active set has drifted since 2026-07-14 -- STOP, re-verify the id list '
      'live before proceeding, do not just bump this number.', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1b) Snapshot: toor_commercial_listings active rows -> full-row backup.
--     (Expected to insert 0 rows -- verified 0 active live on 2026-07-14.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.toor_commercial_listings_backup_20260714
  (LIKE public.toor_commercial_listings INCLUDING ALL);

INSERT INTO public.toor_commercial_listings_backup_20260714
SELECT * FROM public.toor_commercial_listings
WHERE active = true;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.toor_commercial_listings_backup_20260714;
  IF n <> 0 THEN
    RAISE EXCEPTION
      'Expected 0 active toor_commercial_listings rows (verified live '
      '2026-07-14), got %. The active set has drifted -- STOP, re-verify '
      'live, this script does not know how to handle commercial rows and '
      'was never designed/tested against a non-zero count.', n;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Deactivate exactly the backed-up rows (same id list, same active=true
--    guard -- this UPDATE can only ever touch rows that were just backed up).
-- ---------------------------------------------------------------------------
UPDATE public.toor_residential_listings
SET active = false,
    deactivated_at = now()
WHERE id IN (SELECT id FROM public.toor_residential_listings_backup_20260714)
  AND active = true;

UPDATE public.toor_commercial_listings
SET active = false,
    deactivated_at = now()
WHERE id IN (SELECT id FROM public.toor_commercial_listings_backup_20260714)
  AND active = true;

COMMIT;

-- ============================================================================
-- Downstream propagation (no action needed -- verified live 2026-07-14 this
-- is sufficient, using 'deal' as the empirical proof: deal_residential /
-- deal_commercial have 0 active rows today and 0 rows in both
-- active_listing_ids_v2 and search_listings_ar filtered to those source
-- tables):
--   - cron.job jobid=17 "refresh_listing_native_location_v1" (hourly, :00)
--     refreshes the materialized views active_listing_ids_v2 and
--     listing_native_location_v1 -- toor_residential_listings /
--     toor_commercial_listings are already present in active_listing_ids_v2's
--     UNION ALL with the same `WHERE <table>.active IS TRUE` guard as every
--     other platform (confirmed via pg_get_viewdef on 2026-07-14) -- no view
--     DDL change is needed.
--   - cron.job jobid=28 "sync-search-listings-ar" (hourly, :15) runs
--     sync_search_listings_ar(), which rebuilds search_listings_ar from
--     listing_native_location_v2 (itself joined off active_listing_ids_v2),
--     plus a redundant safety net prune_inactive_from_search() (confirmed to
--     exist live via pg_proc) that directly deletes any search_listings_ar
--     row whose source table now says inactive, independent of the view
--     refresh timing.
--   - Net effect: within at most ~75 minutes of this script committing, all
--     23 rows disappear from active_listing_ids_v2 and search_listings_ar,
--     i.e. from every search surface. The 4 toor_commercial rows are already
--     absent (0 active already).
-- ============================================================================

-- ============================================================================
-- VERIFICATION QUERIES to run AFTER applying (read-only):
--   SELECT count(*) FROM public.toor_residential_listings WHERE active = true; -- expect 0
--   SELECT count(*) FROM public.toor_commercial_listings WHERE active = true;  -- expect 0
--   SELECT count(*) FROM public.toor_residential_listings_backup_20260714;     -- expect 23
--   SELECT count(*) FROM public.toor_commercial_listings_backup_20260714;      -- expect 0
--   -- after the next jobid=17 / jobid=28 runs (or immediately, since the
--   -- view refresh is `refresh materialized view concurrently`, so it is
--   -- safe to just wait for the top of the next hour):
--   SELECT count(*) FROM active_listing_ids_v2
--     WHERE source_table IN ('toor_residential_listings','toor_commercial_listings'); -- expect 0
-- ============================================================================

-- ============================================================================
-- REVERSAL (restore exactly these rows to active, if this needs to be undone
-- before the backup tables are ever cleaned up):
--   BEGIN;
--   UPDATE public.toor_residential_listings t
--   SET active = true, deactivated_at = NULL
--   FROM public.toor_residential_listings_backup_20260714 b
--   WHERE t.id = b.id;
--
--   UPDATE public.toor_commercial_listings t
--   SET active = true, deactivated_at = NULL
--   FROM public.toor_commercial_listings_backup_20260714 b
--   WHERE t.id = b.id;
--   COMMIT;
--   -- (then wait for jobid=17 / jobid=28, or manually
--   --  `select public.sync_search_listings_ar();` after the view refresh,
--   --  to bring the rows back into search_listings_ar)
-- ============================================================================
