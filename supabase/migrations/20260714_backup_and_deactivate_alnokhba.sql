-- Backup + deactivate alnokhba's currently-active rows.
-- NOT EXECUTED. Written for review; run manually (or via apply_migration after PR review) once
-- a real worktree/branch exists. Every id below was confirmed live 2026-07-14 with a read-only
-- SELECT (see the block just above each step) before being hardcoded into the WHERE clause --
-- there is no blanket WHERE anywhere in this file.

-- =====================================================================================
-- STEP 0 -- confirmation queries actually run 2026-07-14 (read-only, results quoted verbatim)
-- =====================================================================================

-- select id, active from alnokhba_residential_listings order by id;
--   638602 | false   <-- the pre-existing inactive row. NOT in any WHERE clause below.
--   638603 | true
--   638604 | true
--   638605 | true
--   638606 | true
--   638607 | true
-- select count(*), count(*) filter (where active), count(*) filter (where not active),
--        count(*) filter (where active is null) from alnokhba_residential_listings;
--   total=6, active_true=5, active_false=1, active_null=0
--
-- select count(*), count(*) filter (where active) from alnokhba_commercial_listings;
--   total=0, active_true=0   -- table is empty; nothing to back up or deactivate there.
--
-- Sanity check (also run live, 0 rows returned -- confirms none of the 5 target ids are
-- already inactive, i.e. this script cannot accidentally re-deactivate row 638602):
--   select count(*) from alnokhba_residential_listings
--     where id in (638603,638604,638605,638606,638607) and active is not true;
--   -> 0

BEGIN;

-- =====================================================================================
-- STEP 1 -- snapshot the exact 5 active rows into a dated backup table (reversible), same
-- ad-hoc-backup pattern as the existing ops_price_repair_backup_20260713 table in this DB.
-- =====================================================================================
CREATE TABLE IF NOT EXISTS alnokhba_residential_listings_backup_20260714 AS
SELECT * FROM alnokhba_residential_listings
WHERE id IN (638603, 638604, 638605, 638606, 638607);

-- Verify the backup captured exactly 5 rows before touching the source table.
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM alnokhba_residential_listings_backup_20260714;
  IF n <> 5 THEN
    RAISE EXCEPTION 'Expected exactly 5 backed-up rows, got %. Aborting.', n;
  END IF;
END $$;

-- alnokhba_commercial_listings has 0 rows total (confirmed live above) -- no backup table and
-- no UPDATE needed for it. Left out deliberately rather than creating an empty backup table.

-- =====================================================================================
-- STEP 2 -- deactivate exactly those 5 ids. Never a blanket WHERE platform/source clause --
-- always an explicit id list, so a future re-scrape of alnokhba (if the domain ever comes back)
-- cannot be silently re-deactivated by this script if accidentally re-run (IN-list is static).
-- =====================================================================================
UPDATE alnokhba_residential_listings
SET active = false,
    deactivated_at = now()
WHERE id IN (638603, 638604, 638605, 638606, 638607);

-- Confirm exactly 5 rows were updated and row 638602 is untouched.
DO $$
DECLARE
  updated_count int;
  row_638602_active boolean;
BEGIN
  SELECT count(*) INTO updated_count
  FROM alnokhba_residential_listings
  WHERE id IN (638603, 638604, 638605, 638606, 638607) AND active = false;

  IF updated_count <> 5 THEN
    RAISE EXCEPTION 'Expected 5 rows deactivated, got %. Aborting.', updated_count;
  END IF;

  SELECT active INTO row_638602_active
  FROM alnokhba_residential_listings WHERE id = 638602;

  IF row_638602_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Row 638602 active flag changed unexpectedly (now %). Aborting.',
      row_638602_active;
  END IF;
END $$;

COMMIT;

-- =====================================================================================
-- Downstream effect -- no further action needed. Proven live 2026-07-14 using the 'deal'
-- platform (already deactivated the same way, 2026-06-26):
--   select count(*) from deal_residential_listings;                                    -- 36
--   select count(*) from active_listing_ids_v2
--     where source_table in ('deal_residential_listings','deal_commercial_listings');  -- 0
-- active_listing_ids_v2 is a materialized view that UNIONs each platform's
-- "...WHERE active IS TRUE" branch; alnokhba_residential_listings/alnokhba_commercial_listings
-- are already present in that UNION with the same active IS TRUE guard. Once the hourly
-- jobid 17 refresh (active_listing_ids_v2 / listing_native_location_v1) and hourly jobid 28
-- (sync_search_listings_ar) run after this UPDATE commits, the 5 rows drop out of both the
-- matview and search_listings_ar on their own -- no manual view/DDL edit required for search
-- removal.
--
-- Freshness-alert caveat (informational only, NOT part of this script's scope): deactivating
-- these rows does not, by itself, stop check_scraper_freshness() from eventually alerting on
-- alnokhba staleness -- that function only special-cases 'deal' via a hardcoded
-- `tablename not like 'deal\_%'` literal, and neither deprecated_platforms nor
-- platforms_deprecated_status is read by any function/view in `public` (confirmed live via a
-- full grep of every pg_get_functiondef/pg_get_viewdef in the schema). Silencing alnokhba
-- freshness alerts needs a separate `CREATE OR REPLACE FUNCTION check_scraper_freshness()`
-- adding `and tablename not like 'alnokhba\_%'` -- real DDL, out of scope for this DML script,
-- needs its own reviewed migration.

-- =====================================================================================
-- ROLLBACK (reverse of the above, in case this needs to be undone)
-- =====================================================================================
-- BEGIN;
-- UPDATE alnokhba_residential_listings a
-- SET active = b.active,
--     deactivated_at = NULL
-- FROM alnokhba_residential_listings_backup_20260714 b
-- WHERE a.id = b.id;
-- DROP TABLE alnokhba_residential_listings_backup_20260714;
-- COMMIT;
