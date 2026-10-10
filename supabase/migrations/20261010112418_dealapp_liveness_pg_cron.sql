-- Dealapp liveness dispatched by pg_cron every 2 hours (♻️ lifecycle, 2026-10-10).
--
-- dealapp-liveness.yml carried a GitHub `schedule:` (40 */2 * * *) and GitHub fired it 2-5 times
-- a day instead of 12 (scrape_runs dealapp_liveness, 2026-10-02..10-10: 3-5 runs of 600 ads), so
-- dealapp's checked-in-time share rode on the crawl re-reading pages and fell 96.0% -> 82.8%
-- between 2026-10-09 09:19 and 2026-10-10 10:19 UTC (ops_liveness_coverage_snapshot) while its
-- active rows grew 19,400 -> 20,927. Every other lifecycle job is dispatched by a pg_cron row
-- (LIFECYCLE_ENGINEER.md: a workflow's own schedule is not a schedule here); this gives dealapp the
-- same. trigger_gh_workflow() passes no inputs and a bare dispatch of dealapp-liveness.yml is a
-- dry run by design, so the row dispatches the wrapper dealapp-liveness-cron.yml, which calls the
-- real workflow with apply=true (same code, same 600-ad limit, same view-quota pacing, same
-- concurrency group). The GitHub `schedule:` was removed in the same change so a slot never runs
-- twice. 12 runs x 600 = ~7,200 own-page reads a day on CI egress, the cadence the owner chose
-- on 2026-09-28; the paid proxy is not touched.
select cron.schedule('gh-dealapp-liveness', '40 */2 * * *',
  $$select public.trigger_gh_workflow('dealapp-liveness-cron.yml')$$);
