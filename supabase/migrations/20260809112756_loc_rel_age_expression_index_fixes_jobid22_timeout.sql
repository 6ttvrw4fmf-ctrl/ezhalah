-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- cron jobid 22 (loc_rel_refresh_tick) recurring statement timeout — ROOT CAUSE FIX
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2026-08-09. jobid 22 failed ~1x/day with:
--     ERROR: canceling statement due to statement timeout
--     CONTEXT: SQL function "age_from_text_ar" statement 1
--              SQL statement "insert into listing_location_relations (...)"
-- Occurrences: 08-04 x3, 08-05, 08-06, 08-08, 08-09. (A DIFFERENT and older failure than the
-- `invalid transaction termination ... at COMMIT` bug, which 20260807164314 fixed and whose last
-- occurrence was 2026-08-07 16:30 UTC.)
--
-- ROOT CAUSE — a cardinality misestimate, not data volume.
-- listing_native_location_v2 has a UNION arm filtering on an opaque IMMUTABLE function:
--     where active and jsonb_typeof(additional_info)='object'
--       and age_from_text_ar(additional_info->>'property_age_text') between 0 and 100
-- With no statistics for that expression the planner estimates rows=1 (actual 198) and chooses a
-- Nested Loop, re-executing the arm once per outer row. Measured on dealapp_commercial_listings —
-- a table with only 287 active rows — the arm ran with loops=351, each loop a full Seq Scan
-- evaluating age_from_text_ar TWICE per row: ~247,000 regex-heavy calls for a 287-row table.
--
--   EXPLAIN ANALYZE, count(*) over listing_native_location_v2 for that one table:
--     BEFORE: Seq Scan   (actual time=0.077..27.615 rows=198 loops=351)  Execution Time: 9741 ms
--     AFTER : Index Scan (actual time=0.003..0.172 rows=198 loops=351)   Execution Time:   77 ms
--   => 126x faster on a SMALL table. loc_rel_refresh_one() runs this join for the table it is
--   refreshing, so the same shape blows past the 600s statement_timeout — which is the observed
--   failure, and why a 287-row table could be the victim on 2026-08-09 00:45.
--
-- THE FIX — give the planner real statistics for the expression by indexing it.
-- An expression index makes ANALYZE collect stats for age_from_text_ar(...), AND lets the arm use
-- an Index Scan instead of re-evaluating the function per row per loop. Nothing about the data,
-- the view, the refresh logic, or the timeout changes — a pure plan fix, so it cannot alter any
-- result. CREATE STATISTICS on the same expression was tried FIRST and did NOT move the estimate
-- (9742ms -> 9731ms, identical plan); only the index does.
--
-- The three largest tables (aqar_residential ~101k, wasalt_residential ~62k, gathern_residential
-- ~31k) were built with CREATE INDEX CONCURRENTLY immediately before this migration so they never
-- took an ACCESS EXCLUSIVE lock against live scraper writes. The loop below is IF NOT EXISTS, so
-- it no-ops for those three and builds the remaining (small, sub-second) tables.
--
-- The loop is data-driven over the catalog rather than a hardcoded table list, so a platform table
-- added later is covered the next time this runs, with no edit here.
-- Guarded by scripts/verify-loc-rel-age-expression-indexes.ts (in `npm test`).
--
-- VERIFIED AFTER APPLYING: 67/67 indexes built, 0 invalid. loc_rel_refresh_one(
-- 'dealapp_commercial_listings') — the table left stuck in last_status='running' by the 00:45
-- timeout — completed in ~9s with last_status='ok', 351 active / 494 signals.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname LIKE '%\_listings'
      AND EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attname = 'additional_info' AND NOT a.attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attname = 'active' AND NOT a.attisdropped)
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I '
      '((public.age_from_text_ar(additional_info->>''property_age_text''))) WHERE active',
      left('ix_lra_' || r.relname, 63), r.relname);
  END LOOP;
END
$do$;

COMMENT ON FUNCTION public.age_from_text_ar(text) IS
  'Canonical Arabic property-age parser. IMMUTABLE and expensive (regex-heavy). Every platform '
  'listings table carries an expression index ix_lra_<table> on '
  'age_from_text_ar(additional_info->>''property_age_text'') WHERE active — those indexes are what '
  'keep the listing_native_location_v2 age arm from being re-evaluated per row per nested-loop '
  'iteration (2026-08-09 jobid 22 timeout fix). Do not drop them; see '
  'scripts/verify-loc-rel-age-expression-indexes.ts.';
