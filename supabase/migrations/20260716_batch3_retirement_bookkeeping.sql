-- ============================================================================
-- Batch 3 (deletion safety), 2026-07-16: retirement bookkeeping catch-up.
--
-- docs/ARCHITECTURE.md §12 lists THREE retired/deprecated platforms (toor,
-- alnokhba, deal) but the live bookkeeping held only 'deal' (verified
-- read-only 2026-07-16 against project aannarbkwcymrotzwdbo:
--   select * from deprecated_platforms;  -> 1 row: 'deal'
-- ). The toor and alnokhba inserts were drafted on 2026-07-14
-- (supabase/migrations/20260714_deprecate_toor.sql and
-- 20260714_deprecate_alnokhba.sql) but never applied. This migration applies
-- the deprecated_platforms INSERTs from those drafts (reason text preserved
-- verbatim) so the live bookkeeping finally matches §12.
--
-- ⚠ CORRECTION TO THE 2026-07-14 DRAFTS (found during the Batch 3
-- BEGIN/ROLLBACK test, 2026-07-16): both drafts also INSERT into
-- `platforms_deprecated_status`, describing it as a table with "NO primary
-- key / unique constraint". It is actually a VIEW (pg_class.relkind='v')
-- over `deprecated_platforms`:
--     platform / reason / deprecated_at  -> pass through from the base table
--     rows_retained                      -> computed (hardcoded to count the
--                                           deal_* tables only; shows 0 for
--                                           every other platform)
--     still_in_search                    -> computed live from
--                                           listing_native_location_v2
-- Inserting into it fails with SQLSTATE 0A000 ("cannot insert into column
-- rows_retained of view"). So the drafts' second INSERT per platform is
-- impossible AND unnecessary — the view reflects the base-table rows
-- automatically. It is intentionally dropped here. (That the view's
-- rows_retained is deal-only hardcoding is a pre-existing view deficiency,
-- out of scope for this DML-only migration; the authoritative retained
-- counts are recorded below and in ARCHITECTURE.md §12.)
--
-- SAFETY PROPERTIES:
--   * DML only — one INSERT per platform, no UPDATE/DELETE/DDL.
--   * Idempotent — deprecated_platforms has PK(platform) -> ON CONFLICT DO
--     NOTHING (re-running is a no-op; verified in the rollback test).
--   * No behavior change — verified 2026-07-14 and reconfirmed 2026-07-16:
--     no function reads deprecated_platforms; the only consumer is the
--     platforms_deprecated_status view (itself read by nothing). Freshness-
--     alert suppression is a hardcoded `not like 'deal\_%'` literal inside
--     check_scraper_freshness() and is NOT affected by these rows.
--   * Retained-row counts re-verified live 2026-07-16:
--       toor_residential_listings 25 + toor_commercial_listings 4 = 29
--       alnokhba_residential_listings 6 + alnokhba_commercial_listings 0 = 6
--
-- ROLLBACK:
--   BEGIN;
--   DELETE FROM public.deprecated_platforms WHERE platform IN ('toor','alnokhba');
--   COMMIT;
-- ============================================================================

BEGIN;

-- ── toor (retired 2026-07-06, owner-approved; drafted 20260714_deprecate_toor.sql) ──────────────
-- 29 rows retained (25 residential + 4 commercial). NOTE (found during the 2026-07-16 rollback
-- test): 1 residential row (TR357125e4-…) is ACTIVE again — PR #77 re-added toor to the
-- small-sources matrix on 2026-07-15 and the 04:22 UTC dispatches on 07-15/07-16 ran it before
-- PR #88's re-retirement merged (2026-07-16 10:47 UTC); the 07-16 run re-upserted that row
-- (active=true, missing_count=0, last_seen_at 05:09 UTC), so platforms_deprecated_status shows
-- still_in_search=true for toor until it ages out via mark_stale_listings_inactive(7) around
-- 2026-07-23, or until an owner-approved exact-id deactivation lands sooner. That is row state,
-- not bookkeeping — it does not change this INSERT.

INSERT INTO public.deprecated_platforms (platform, reason, deprecated_at)
VALUES (
  'toor',
  'Host www.toor.ooo IP-blocks GitHub datacenter IPs AND the Saudi residential '
  'proxy (every detail-page fetch = exc:Timeout, 0 rows written for weeks). '
  'Owner approved full retirement 2026-07-06. Removed from the '
  'small-sources-sync.yml matrix (PR #33, commit d5ca9d6) so the daily '
  'gh-small-sources cron (jobid=12) no longer schedules/dispatches it. '
  'Historical toor rows are KEPT in the DB (29 rows, not deleted); scrapers/toor/ and '
  'the ResultCard toor logo remain so existing listings still render. '
  'Do not re-add without owner approval. See docs/ARCHITECTURE.md section 12.',
  now()
)
ON CONFLICT (platform) DO NOTHING;

-- ── alnokhba (deprecated 2026-07-14; drafted 20260714_deprecate_alnokhba.sql) ───────────────────
-- 6 rows retained (6 residential + 0 commercial), 0 active since the 20260714 deactivation.

INSERT INTO public.deprecated_platforms (platform, reason)
VALUES (
  'alnokhba',
  'Source domain alnokhba-services.com has lapsed into a domain-parking page. Verified 2026-07-14: '
  'HTTP GET to /properties and / both return 200, but the response body is a third-party '
  'parking placeholder (assets.abovedomains.com/javascript/forsale.min.js, no property-card '
  'markup) -- reachable, but serves no listing content. scrape_runs shows the last successful '
  'content pull (rows_seen=5) was 2026-07-07 04:22 UTC; every daily run 2026-07-08 through '
  '2026-07-14 (7 consecutive runs) returned ok=true, rows_seen=0 -- a silent zero-result death, '
  'not a scraper bug. Tables retained for historical listings (6 rows); excluded from production '
  'search + counts. Do not re-add without confirming the domain is serving real content again.'
)
ON CONFLICT (platform) DO NOTHING;

COMMIT;

-- ============================================================================
-- Post-apply verification (read-only):
--   SELECT platform, deprecated_at FROM public.deprecated_platforms ORDER BY deprecated_at;
--     -> 3 rows: deal (2026-06-26), toor, alnokhba (both apply-time)
--   SELECT platform, rows_retained, still_in_search FROM public.platforms_deprecated_status;
--     -> 3 rows via the view; still_in_search=false for all three; note
--        rows_retained reads 36/0/0 because the view hardcodes deal_* counts
--        (see the correction block above) — the real retained counts are
--        toor=29, alnokhba=6.
-- ============================================================================
