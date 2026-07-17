-- Automatic participation (Phase 2 completion): run rebuild_age_producer() hourly at :05, 10 minutes
-- before the search sync (job 28, '15 * * * *'). Regenerates listing_age_resolved from the current
-- registry + data-driven gate, so a newly-trusted platform flows without a manual rebuild, and a
-- platform whose data drifts into build_year/sentinel is auto-excluded next cycle (safety). A SEPARATE
-- cron (not an edit to sync_search_listings_ar) keeps the producer decoupled: if a rebuild ever fails,
-- the sync still runs against the last-good producer view. Applied live via MCP 2026-07-17 (cron jobid 46).
SELECT cron.schedule(
  'rebuild-age-producer',
  '5 * * * *',
  $$ set statement_timeout to '120s'; select public.rebuild_age_producer(); $$
);
