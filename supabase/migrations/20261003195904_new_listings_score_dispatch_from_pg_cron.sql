-- The 🆕 New Listings Engineer's nightly score, dispatched by pg_cron like every other job here (owner,
-- 2026-10-03: «I don't want to check, it should work by itself»). The engineer's cloud container has no
-- service key, so on 2026-10-03 it hand-computed its rating and ops_new_listings_score stayed empty.
-- new-listings-score.yml (CI holds the key) compares a sample of the last 24 hours of arrivals with their
-- original pages, writes one row per website, and prints the report numbers into its log.
--
-- 08:35 UTC = 01:35 Arizona: after the nightly crawls begin to settle and about 85 minutes before the engineer
-- wakes at 10:00 UTC. The workflow is dispatch-only (no GitHub schedule: those never fired here).
select cron.schedule('gh-new-listings-score', '35 8 * * *',
  $$select public.trigger_gh_workflow('new-listings-score.yml')$$);
