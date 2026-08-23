-- Migrate aqar and wasalt hard-delete cleanup onto the unified, safety-proven retention engine
-- (scrapers/common/cleanup.py), retiring reliance on the legacy scrapers/aqar/cleanup.py path.
--
-- OWNER-DIRECTED SAFETY AUDIT, 2026-08-22. The core danger investigated: a scraper failure, proxy
-- block, timeout, source outage, parser bug, or temporary 403/5xx must never cause a real listing
-- to be hard-deleted. Finding: the shared inactivation logic (scrapers/aqar/liveness.py,
-- scrapers/wasalt/liveness.py) already gets this right — missing_count only increments on a
-- CONFIRMED dead signal (404/410/dead-marker text), never on a transient failure, and wasalt
-- additionally has a per-shard collapse guard (>30% dead in one sweep = broken crawl, strike
-- nothing). The gap was one stage further down: the WEEKLY HARD-DELETE step
-- (scrapers/aqar/cleanup.py, shared by both aqar-cleanup.yml and wasalt-cleanup.yml, pg_cron jobs
-- gh-aqar-cleanup / gh-wasalt-cleanup) trusted that historical missing_count/age state alone, with
-- NO final live re-check immediately before deleting, NO anomaly/spike circuit breaker, NO
-- fraction-of-platform guard, and NO per-row audit trail beyond an aggregate count in
-- scrape_runs.notes.
--
-- MEASURED EXPOSURE at audit time: 4,392 rows across the 4 aqar/wasalt tables (aqar_residential
-- 2,352, aqar_commercial 120, wasalt_residential 1,859, wasalt_commercial 61) were eligible for
-- hard-delete under the legacy rule with zero further verification.
--
-- THE FIX ALREADY EXISTED AND WAS ALREADY PROVEN SAFE, just not turned on for these two platforms.
-- 20260727115000_retention_cleanup_framework.sql registered aqar and wasalt in the unified engine's
-- PLATFORMS dict (scrapers/common/cleanup.py) with working dead-marker checks, but deliberately
-- left both enabled=false "until they're deliberately migrated onto the engine (so we never have
-- two paths deleting the same table at once)". That engine requires, before any delete: (1) a
-- FRESH re-fetch of the real listing_url immediately before deletion — 404/410/dead-marker only;
-- any 403/429/5xx/timeout/network-error is treated as inconclusive and the row is SKIPPED, never
-- deleted; a live 200 REACTIVATES the row instead; (2) an anomaly gate — eligible_total >
-- max(anomaly_floor, anomaly_factor × trailing-30d median deleted) aborts the ENTIRE run and
-- deletes nothing; (3) a mass-inactivation fraction guard — eligible_total > 10% of the platform's
-- row count (on platforms >=500 rows) aborts too, catching a proxy-block-shaped spike the absolute
-- floor alone might miss; (4) a full per-row audit trail in cleanup_deletion_log (listing_id,
-- platform, source_table, ad_number, listing_url, and a reason JSON with inactive_days,
-- missing_count, http_status, verdict); (5) mon_detect_deletion_spike() as a second, independent
-- P1 tripwire over cleanup_runs, in production since 2026-07-27 and PROVEN firing for real:
-- gathern aborted 7 times running 2026-08-09/10 (301 candidates > 300 floor) and aqarcity aborted
-- once 2026-08-16 (414 > 408 threshold) before either was unblocked by an explicit, bounded,
-- owner-reviewed exception. 18 unit tests in scrapers/common/tests/test_cleanup.py cover exactly
-- the scenarios this audit was asked to simulate (live→reactivated-never-deleted,
-- dead-marker/404→deleted, block/network-error→skipped-never-deleted, anomaly-spike-aborts,
-- disabled-policy-deletes-nothing, dry-run-deletes-nothing, bounded-cap-never-exceeds-gates).
--
-- THIS MIGRATION DOES NOT CHANGE THE 30-day / 3-strike THRESHOLDS. Those were measured, not
-- assumed: the engine's own dry-runs on gathern (18-day pilot, 2026-07-27) found 14/50 (28%) of
-- missing_count>=3+30-day-eligible rows were STILL LIVE at the final recheck — i.e. the
-- age/strike-count rule alone, with no final recheck, would have wrongly deleted better than 1 in
-- 4 real listings on gathern. aqarcity's pilot found 0/50 false. This migration adds that same
-- final-recheck layer to aqar/wasalt rather than re-deriving new thresholds from scratch.
--
-- Same filenames, same pg_cron schedule (gh-aqar-cleanup Sun 02:00 UTC, gh-wasalt-cleanup Sun
-- 02:30 UTC) — only the workflow bodies changed (this PR) to call scrapers.common.cleanup instead
-- of scrapers.aqar.cleanup. REQUIRED ROLLOUT SEQUENCE, not automatic: after this migration and the
-- paired workflow files are both merged and applied, a human must manually dispatch each workflow
-- with dry_run=true and review the report BEFORE the next scheduled Sunday run is allowed to
-- execute for real. This migration intentionally does NOT force that step — it cannot verify a
-- human read a report — so treat "merged" as "ready for a dry run", not "safe to leave unattended".

update public.platform_retention_policy
   set enabled = true,
       note = 'Migrated onto the unified engine 2026-08-22 (owner-directed safety audit, PR TBD). '
              || 'Legacy aqar-cleanup.yml/wasalt-cleanup.yml now call scrapers.common.cleanup '
              || 'instead of the old no-recheck scrapers/aqar/cleanup.py — same filenames, same '
              || 'pg_cron schedule, same 30-day/3-strike thresholds, PLUS the final live re-check + '
              || 'anomaly/fraction guards + per-row audit trail this platform never had before. '
              || 'REQUIRED: the first run after this ships must be a manual dry_run=true dispatch, '
              || 'reviewed by a human, before the next scheduled real run.'
 where platform in ('aqar', 'wasalt');

-- Fail loud, not quiet, if the expected rows are somehow missing (the seed migration inserts them
-- with ON CONFLICT DO NOTHING, so both should always exist by the time this runs).
do $$
declare n int;
begin
  select count(*) into n from public.platform_retention_policy where platform in ('aqar','wasalt') and enabled;
  if n <> 2 then
    raise exception 'expected exactly 2 platform_retention_policy rows (aqar, wasalt) enabled=true after this migration, got %', n;
  end if;
end $$;
