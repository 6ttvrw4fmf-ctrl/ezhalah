-- ops_freshness_by_layer reported aqar — the largest platform, 85,302 rows — as 48 DAYS stale.
--
-- It joins scrape_runs on an EXACT platform-name match, but aqar has never recorded runs under the
-- bare name 'aqar': it writes 'aqar_residential', 'aqar_commercial' and 'aqar_liveness:<table>:n/16'.
-- The last row literally named 'aqar' is from 2026-06-18, so the view has been showing
-- scraper_last_ok = 2026-06-18 ever since, while aqar in fact ran at 2026-08-06 01:18 and upserted
-- 44,650 rows in the preceding 30 hours. wasalt and gathern were wrong the same way, by hours
-- rather than weeks (wasalt_enrich_ar_*, gathern_prune).
--
-- This is a measurement defect, not an outage: the detectors read scrape_runs directly and were
-- correctly silent. But this view is what a human or an agent reads to answer "is this platform
-- alive?", and it answers "aqar died seven weeks ago". That is how a run burns itself investigating
-- a phantom outage — or, worse, learns to discount the view and misses a real one.
--
-- Fix: match the platform OR its own sub-jobs, `<platform>_%`. The underscore is required, so
-- 'aqar' cannot absorb 'aqarcity' / 'aqargate' / 'aqarmonthly' / 'aqaratikom'. Verified against live
-- data: exactly 3 platforms change (aqar, wasalt, gathern) and every other row is byte-identical.
-- Reporting only; no listing, search or product behaviour is touched.

create or replace view public.ops_freshness_by_layer as
 SELECT platform,
    max(last_updated) AS search_last,
    max(last_updated) AS ui_visible_last,
    ( SELECT max(l.last_updated) AS max
           FROM listing_location_canonical l
          WHERE l.platform = s.platform) AS canonical_last,
    ( SELECT max(r.started_at) AS max
           FROM scrape_runs r
          WHERE (r.platform = s.platform OR r.platform LIKE s.platform || '\_%') AND r.ok) AS scraper_last_ok,
    ( SELECT max(r.started_at) AS max
           FROM scrape_runs r
          WHERE (r.platform = s.platform OR r.platform LIKE s.platform || '\_%') AND r.ok AND COALESCE(r.rows_upserted, 0) > 0) AS raw_last_write,
    ( SELECT max(d.end_time) AS max
           FROM cron.job_run_details d
          WHERE d.jobid = 16 AND d.status = 'succeeded'::text) AS canonical_snapshot_at,
    ( SELECT max(d.end_time) AS max
           FROM cron.job_run_details d
          WHERE d.jobid = 28 AND d.status = 'succeeded'::text) AS search_synced_at
   FROM search_listings_ar s
  GROUP BY platform;
