-- Migration: deprecate the "alnokhba" platform
-- Branch: fix/deprecate-alnokhba-2026-07-14 (see 00_README_NOT_COMMITTED.md for why this file
--         is not actually committed to that branch yet — the promised worktree does not exist).
-- NOT APPLIED. Do not run via apply_migration/execute_sql against project aannarbkwcymrotzwdbo
-- without owner sign-off. Written for human review + later `apply_migration` once a real
-- worktree/PR exists.
--
-- Mirrors the existing 'deal' row exactly (verified live 2026-07-14 via:
--   select * from deprecated_platforms;          -- -> platform='deal', reason='Duplicate of
--     dealapp (same site dealapp.sa). JSON-API experiment, reverted 2026-06-24. Tables retained
--     for a future coverage project; excluded from production search + counts.',
--     deprecated_at='2026-06-26 16:40:39.641531+00'
--   select * from platforms_deprecated_status;   -- -> same platform/reason/deprecated_at, plus
--     rows_retained=36, still_in_search=false
-- ).
--
-- Evidence for the alnokhba reason text (all directly observed 2026-07-14, see
-- 00_README_NOT_COMMITTED.md "Correction to the reason text" for the full walkthrough):
--
--   $ curl -s -o /dev/null -w "%{http_code}" --max-time 15 https://alnokhba-services.com/properties
--   200
--   $ curl -s --max-time 15 https://alnokhba-services.com/properties
--   <!DOCTYPE html><html><head><title>alnokhba-services.com</title>
--   <script async src="https://assets.abovedomains.com/javascript/forsale.min.js?d=alnokhba-services.com"></script>
--   <style>body{background:#101c36;color:#fff}h1{text-align:center;margin-top:1rem}</style>
--   </head><body><h1>alnokhba-services.com</h1></body></html>
--
--   -- scrape_runs (live query, platform='alnokhba', last 15 runs, most recent first):
--   --   2026-07-14 04:22 ok=true rows_seen=0 rows_upserted=0 notes="pruned=0"
--   --   2026-07-13 04:22 ok=true rows_seen=0 rows_upserted=0 notes="pruned=0"
--   --   2026-07-12 04:22 ok=true rows_seen=0 rows_upserted=0 notes="pruned=0"
--   --   2026-07-11 04:22 ok=true rows_seen=0 rows_upserted=0 notes="pruned=0"
--   --   2026-07-10 04:22 ok=true rows_seen=0 rows_upserted=0 notes="pruned=0"
--   --   2026-07-09 04:27 ok=true rows_seen=0 rows_upserted=0 notes="pruned=0"
--   --   2026-07-08 04:22 ok=true rows_seen=0 rows_upserted=0 notes="pruned=0"
--   --   2026-07-07 04:22 ok=true rows_seen=5 rows_upserted=5 notes="pruned=0"   <- last real pull
--   --   2026-07-06 13:15 ok=true rows_seen=5 rows_upserted=5 notes="pruned=0"
--   --   2026-07-06 04:22 ok=true rows_seen=5 rows_upserted=5 notes="pruned=0"
--   -- i.e. the site went from serving 5 real listings to a zero-card parking page sometime
--   -- between the 2026-07-07 04:22 UTC run and the 2026-07-08 04:22 UTC run, and has stayed
--   -- that way for 7 consecutive daily runs through 2026-07-14. ok=true throughout because the
--   -- HTTP GET succeeds (200) — this is the "silent death" pattern (no exception, no freshness
--   -- alert), not a network failure.

BEGIN;

-- deprecated_platforms: platform text PRIMARY KEY, reason text NOT NULL,
-- deprecated_at timestamptz NOT NULL DEFAULT now()  (schema confirmed live via
-- information_schema.columns + pg_constraint, 2026-07-14)
INSERT INTO deprecated_platforms (platform, reason)
VALUES (
  'alnokhba',
  'Source domain alnokhba-services.com has lapsed into a domain-parking page. Verified 2026-07-14: '
  'HTTP GET to /properties and / both return 200, but the response body is a third-party '
  'parking placeholder (assets.abovedomains.com/javascript/forsale.min.js, no property-card '
  'markup) -- reachable, but serves no listing content. scrape_runs shows the last successful '
  'content pull (rows_seen=5) was 2026-07-07 04:22 UTC; every daily run 2026-07-08 through '
  '2026-07-14 (7 consecutive runs) returned ok=true, rows_seen=0 -- a silent zero-result death, '
  'not a scraper bug. Tables retained for historical listings; excluded from production search '
  '+ counts. Do not re-add without confirming the domain is serving real content again.'
)
ON CONFLICT (platform) DO NOTHING;

-- platforms_deprecated_status has NO primary key / unique constraint (confirmed live via
-- pg_constraint, 2026-07-14), so guard the insert with NOT EXISTS instead of ON CONFLICT.
-- rows_retained = 6 = alnokhba_residential_listings total (6) + alnokhba_commercial_listings
-- total (0), both counted live 2026-07-14.
INSERT INTO platforms_deprecated_status (platform, reason, deprecated_at, rows_retained, still_in_search)
SELECT
  'alnokhba',
  'Source domain alnokhba-services.com has lapsed into a domain-parking page. Verified 2026-07-14: '
  'HTTP GET to /properties and / both return 200, but the response body is a third-party '
  'parking placeholder (assets.abovedomains.com/javascript/forsale.min.js, no property-card '
  'markup) -- reachable, but serves no listing content. scrape_runs shows the last successful '
  'content pull (rows_seen=5) was 2026-07-07 04:22 UTC; every daily run 2026-07-08 through '
  '2026-07-14 (7 consecutive runs) returned ok=true, rows_seen=0 -- a silent zero-result death, '
  'not a scraper bug. Tables retained for historical listings; excluded from production search '
  '+ counts. Do not re-add without confirming the domain is serving real content again.',
  now(),
  6,
  false
WHERE NOT EXISTS (
  SELECT 1 FROM platforms_deprecated_status WHERE platform = 'alnokhba'
);

COMMIT;

-- Rollback (reverse of the above):
--   BEGIN;
--   DELETE FROM deprecated_platforms WHERE platform = 'alnokhba';
--   DELETE FROM platforms_deprecated_status WHERE platform = 'alnokhba';
--   COMMIT;

-- Explicitly OUT OF SCOPE for this migration (documented here so a reviewer doesn't assume it's
-- covered): confirmed live 2026-07-14 that `deprecated_platforms` / `platforms_deprecated_status`
-- are referenced by ZERO functions/views in `public` (grepped every pg_get_functiondef /
-- pg_get_viewdef) -- `still_in_search` is pure bookkeeping and does NOT suppress
-- check_scraper_freshness() alerts on its own. That function's freshness suppression is a
-- hardcoded `tablename not like 'deal\_%'` literal. If alnokhba freshness alerts need to be
-- silenced too, that requires a separate `CREATE OR REPLACE FUNCTION check_scraper_freshness()`
-- adding `and tablename not like 'alnokhba\_%'` -- real DDL, needs its own reviewed migration/PR,
-- deliberately NOT bundled into this DML-only file. Search removal itself does not need it: see
-- 02_backup_and_deactivate_alnokhba.sql, `active=false` + the existing hourly
-- active_listing_ids_v2/listing_native_location_v1 refresh (jobid 17) and hourly
-- sync_search_listings_ar() (jobid 28) are sufficient on their own -- this was proven live using
-- the 'deal' platform, which already has 0 active rows and 0 rows in
-- active_listing_ids_v2/search_listings_ar for its source tables.
