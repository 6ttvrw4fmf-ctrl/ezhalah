-- Fix the canonical-snapshot ordering bug + make per-layer freshness observable
-- (owner-instructed 2026-07-27, follow-up to the daily audit).
--
-- THE ORDERING BUG: search_listings_ar takes each row's last_updated (and its re-sync trigger)
-- from listing_location_canonical -> listing_location_canonical_mv, refreshed by cron job 16
-- ("refresh-location-index") DAILY AT 02:00 UTC. But ingestion lands AFTER that: the small-source
-- matrix at 04:22, gathern-sync at 04:40, aqarmonthly-sync at 06:00. Result: every small
-- platform's daily update sat invisible in the search layer for ~22h (audits systematically read
-- them as "~30h stale" when the scrapers were in fact running on time, every day).
--
-- MEASURED upstream completion (7-day worst case, GitHub Actions wall-clock):
--   small-sources matrix  04:22 -> 04:48
--   gathern-sync          04:40 -> 04:54
--   aqarmonthly-sync      06:00 -> 06:11:40   <- latest writer feeding listing_location_index
-- 06:30 (the first slot considered) leaves only ~18 min of margin over aqarmonthly's worst finish
-- — inside routine GitHub queue variance, so NOT "safely after". 07:30 gives 78 min of margin,
-- sits after the 07:00 hourly refresh of active_listing_ids_v2/v1 (job 17), and the hourly
-- search sync (job 28, at :15) publishes the fully-consistent picture at 08:15 UTC.
--
-- Safety properties of the move:
--   * REFRESH MATERIALIZED VIEW CONCURRENTLY is atomic — a failed refresh leaves the previous
--     snapshot intact (no partial publish) and is recorded in cron.job_run_details.
--   * Job 16 refreshes listing_location_index THEN listing_location_canonical_mv in one command —
--     internal order preserved by the move; runtime ~41s, no overlap with job 17 (07:00/08:00).
--   * A late/failed scraper run simply means its rows carry yesterday's snapshot timestamps —
--     visible in ops_freshness_by_layer below, never a silently wrong snapshot.
--   * Idempotent: alter_job is declarative; re-running this migration is a no-op.
select cron.alter_job(16, schedule => '30 7 * * *');

-- ── Per-layer freshness, one pane (dashboard-first rule: state lives in Postgres) ───────────────
-- Distinguishes the five layers the 2026-07-27 incident conflated. A platform whose scraper ran
-- but whose canonical snapshot hasn't refreshed yet shows scrape fresh + canonical lagging —
-- report THAT, never "platform stale/unhealthy" from the search layer alone.
--   scraper_last_ok    : the platform's scraper completed (scrape_runs.ok)
--   raw_last_write     : ... and actually wrote rows (rows_upserted > 0) — raw-table freshness proxy
--   canonical_last     : newest last_updated the canonical location snapshot carries for the platform
--   search_last        : newest last_updated in search_listings_ar (what sync has published)
--   ui_visible_last    : identical to search_last BY CONSTRUCTION — the search RPC reads
--                        search_listings_ar directly with no further cache; kept as its own column
--                        so the invariant is asserted, not assumed
create or replace view public.ops_freshness_by_layer as
select
  s.platform,
  max(s.last_updated)                                   as search_last,
  max(s.last_updated)                                   as ui_visible_last,
  (select max(l.last_updated) from listing_location_canonical l
    where l.platform = s.platform)                      as canonical_last,
  (select max(r.started_at) from scrape_runs r
    where r.platform = s.platform and r.ok)             as scraper_last_ok,
  (select max(r.started_at) from scrape_runs r
    where r.platform = s.platform and r.ok
      and coalesce(r.rows_upserted, 0) > 0)             as raw_last_write,
  (select max(d.end_time) from cron.job_run_details d
    where d.jobid = 16 and d.status = 'succeeded')      as canonical_snapshot_at,
  (select max(d.end_time) from cron.job_run_details d
    where d.jobid = 28 and d.status = 'succeeded')      as search_synced_at
from public.search_listings_ar s
group by s.platform;

comment on view public.ops_freshness_by_layer is
  'Per-platform freshness at each pipeline layer: scraper run -> raw write -> canonical snapshot (job 16, daily 07:30) -> search sync (job 28, hourly :15) -> UI (identical to search by construction). Added 2026-07-27 after a scheduling misorder made every small platform look ~30h stale while its scraper ran fine. Judge platform health from scraper_last_ok/raw_last_write; judge PIPELINE health from the canonical/search columns.';
