-- ============================================================================
-- Migration (NOT APPLIED): formally record "toor" as a deprecated platform.
-- Target: Supabase project aannarbkwcymrotzwdbo (LIVE PRODUCTION)
-- Author: prepared by automated investigation, 2026-07-14. DO NOT run against
--          prod without owner review + apply_migration through the normal PR
--          path. This file is DML only (safe to run inside a transaction);
--          the commented-out section at the bottom is DDL and must go through
--          a separate reviewed migration.
--
-- CONTEXT (verified live, read-only, 2026-07-14):
--   - toor was already functionally retired from the scraper pipeline on
--     2026-07-06 (PR #33, commit d5ca9d64a40dc3fea4d22c66f91bd85b5dd2ae40 on
--     origin/main, subject "Retire toor: remove from active small-sources
--     pipeline (owner-approved)"). That PR removed the `toor` matrix line
--     from .github/workflows/small-sources-sync.yml so the daily
--     gh-small-sources cron (cron.job jobid=12) no longer schedules/dispatches
--     it. docs/ARCHITECTURE.md section 12 already documents this as a
--     "Retired platforms" entry (lines 353-359 on origin/main) and explicitly
--     says the DB-side bookkeeping (this file) was left pending because the
--     Supabase connector was down at retirement time.
--   - This migration finishes that pending DB-side bookkeeping step only.
--     It does NOT change any search/visibility behavior by itself (see the
--     companion file 2026-07-14_deactivate_toor_active_rows.sql for the part
--     that actually flips rows inactive).
--
-- SCHEMA VERIFIED LIVE (information_schema.columns, 2026-07-14):
--   deprecated_platforms(platform text NOT NULL PRIMARY KEY,
--                         reason text NOT NULL,
--                         deprecated_at timestamptz NOT NULL DEFAULT now())
--   platforms_deprecated_status(platform text, reason text,
--                                deprecated_at timestamptz,
--                                rows_retained numeric, still_in_search boolean)
--                                -- NO primary key / unique constraint (confirmed
--                                -- via pg_constraint: zero rows returned for
--                                -- this table).
--
-- EXISTING ROWS VERIFIED LIVE (2026-07-14) -- these are the ONLY rows in
-- either table today; there is NO 'alnokhba' row in either table yet, despite
-- other planning docs referring to a 'deal'/'alnokhba' pair -- 'deal' is the
-- only real precedent that exists in the live DB right now:
--
--   deprecated_platforms:
--     platform='deal', deprecated_at='2026-06-26 16:40:39.641531+00',
--     reason='Duplicate of dealapp (same site dealapp.sa). JSON-API
--             experiment, reverted 2026-06-24. Tables retained for a future
--             coverage project; excluded from production search + counts.'
--
--   platforms_deprecated_status:
--     platform='deal', deprecated_at='2026-06-26 16:40:39.641531+00',
--     rows_retained=36, still_in_search=false, reason=<same text as above>
--
-- IMPORTANT CAVEAT, reconfirmed live via
--   `select prosrc/pg_get_functiondef('check_scraper_freshness'::regproc)`
--   and a full grep of every function/view body in `public` for the strings
--   'deprecated_platforms' / 'platforms_deprecated_status':
--   *** These two tables are pure bookkeeping. Zero functions and zero views
--   *** anywhere in the database read `still_in_search` or join against
--   *** either table. check_scraper_freshness() only suppresses alerts for
--   *** a platform via a hardcoded `tablename not like 'deal\_%'` literal in
--   *** its SQL body. Inserting a 'toor' row into these two tables, by
--   *** itself, will NOT suppress toor's freshness alerts. See the
--   *** commented-out DDL block at the bottom of this file for the actual
--   *** fix, which must be shipped as its own reviewed migration.
-- ============================================================================

BEGIN;

-- 1) deprecated_platforms (has PK on `platform` -> ON CONFLICT DO NOTHING is
--    safe/idempotent if this is re-run).
INSERT INTO public.deprecated_platforms (platform, reason, deprecated_at)
VALUES (
  'toor',
  'Host www.toor.ooo IP-blocks GitHub datacenter IPs AND the Saudi residential '
  'proxy (every detail-page fetch = exc:Timeout, 0 rows written for weeks). '
  'Owner approved full retirement 2026-07-06. Removed from the '
  'small-sources-sync.yml matrix (PR #33, commit d5ca9d6) so the daily '
  'gh-small-sources cron (jobid=12) no longer schedules/dispatches it. '
  'Historical toor rows are KEPT in the DB (not deleted); scrapers/toor/ and '
  'the ResultCard toor logo remain so existing listings still render. '
  'Do not re-add without owner approval. See docs/ARCHITECTURE.md section 12.',
  now()
)
ON CONFLICT (platform) DO NOTHING;

-- 2) platforms_deprecated_status (NO PK/unique constraint -> guard manually
--    with NOT EXISTS to keep this idempotent).
INSERT INTO public.platforms_deprecated_status
  (platform, reason, deprecated_at, rows_retained, still_in_search)
SELECT
  'toor',
  'Host www.toor.ooo IP-blocks GitHub datacenter IPs AND the Saudi residential '
  'proxy (every detail-page fetch = exc:Timeout, 0 rows written for weeks). '
  'Owner approved full retirement 2026-07-06. Removed from the '
  'small-sources-sync.yml matrix (PR #33, commit d5ca9d6). Historical rows '
  'kept, not deleted. Do not re-add without owner approval.',
  now(),
  -- rows_retained: total rows across both toor tables, verified live 2026-07-14:
  --   toor_residential_listings: 25 total (23 active, will become 0 active
  --   after the companion deactivation script runs)
  --   toor_commercial_listings:   4 total (0 active already)
  --   25 + 4 = 29
  29,
  -- still_in_search: NOT currently consulted by any function/view (see caveat
  -- above) -- set to false to match the intent/precedent of the 'deal' row,
  -- but note this column has no enforcement today.
  false
WHERE NOT EXISTS (
  SELECT 1 FROM public.platforms_deprecated_status WHERE platform = 'toor'
);

COMMIT;

-- ============================================================================
-- Verification queries to run AFTER applying (read-only):
--   SELECT * FROM public.deprecated_platforms WHERE platform = 'toor';
--   SELECT * FROM public.platforms_deprecated_status WHERE platform = 'toor';
-- ============================================================================

-- ============================================================================
-- REVERSAL (if this needs to be undone):
--   BEGIN;
--   DELETE FROM public.deprecated_platforms WHERE platform = 'toor';
--   DELETE FROM public.platforms_deprecated_status WHERE platform = 'toor';
--   COMMIT;
-- ============================================================================

-- ============================================================================
-- SEPARATE, NOT-YET-DRAFTED-AS-A-FULL-MIGRATION DDL NEEDED TO ACTUALLY
-- SUPPRESS FRESHNESS ALERTS FOR TOOR (must go through apply_migration + PR
-- review, NOT bundled with the DML above):
--
--   CREATE OR REPLACE FUNCTION public.check_scraper_freshness()
--    RETURNS TABLE(platform text, last_scraped_at timestamptz,
--                  hours_stale numeric, expected_hours integer, severity text)
--    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
--   AS $function$
--   declare rec record; t text; m timestamptz; latest timestamptz; exp int; hs numeric; sev text;
--   begin
--     for rec in
--       select regexp_replace(tablename,'_(residential|commercial)_listings$','') as p,
--              array_agg(tablename) as tabs
--       from pg_tables
--       where schemaname='public' and tablename ~ '_(residential|commercial)_listings$'
--         and tablename not like 'deal\_%'
--         and tablename not like 'toor\_%'          -- <-- NEW: added for toor retirement
--       group by 1
--     loop
--       ... (body otherwise unchanged from the live definition) ...
--     end loop;
--   end
--   $function$;
--
-- Reasoning this is correct: pg_get_functiondef() confirms today's live body
-- already special-cases 'deal' with an escaped `not like 'deal\_%'` literal
-- in the exact same loop; adding a second `and tablename not like 'toor\_%'`
-- clause is the minimal, precedent-following change. NOT included as
-- executable DDL above per the hard constraint against CREATE OR REPLACE
-- FUNCTION via execute_sql / apply_migration in this task.
-- ============================================================================
