-- Wasalt enum-liveness: daily -> EVERY 2 DAYS (metered-proxy bandwidth, owner-flagged 2026-07-27).
--
-- WHY: the owner reported DataImpulse usage has exceeded the purchased 10 GB. Attribution from
-- scrape_runs (07-09 15:38, when DataImpulse became WASALT_PROXY_URL, -> 07-27) shows this ONE job
-- is the dominant consumer: of 1,684,193 wasalt rows fetched via the metered proxy, 1,554,318 (92%)
-- came from the 15 daily 21:00 enum singletons. Each run walks every list page of every slice
-- (run.py --all --pages 2000): 90k-121k rows, ~1,000-1,300 page fetches, 4-5.3h, EVERY DAY since
-- 2026-07-12. wasalt-enum-liveness.yml states its own budget in-file: ~285 MB/day enum + <=~45 MB/day
-- confirms ~= ~9 GB/month at daily cadence -- i.e. by design this single job consumes a 10 GB
-- prepaid balance in about one month. Halving the cadence halves that, which is the lever the
-- workflow itself documents ("Cadence is ONE cron line: every-2-days halves it").
--
-- COST: dead-listing flip latency = grace x cadence, so 3 sweeps x 2 days = ~6 days instead of ~3.
-- Long-tail data refresh also goes 1 -> 2 days; the 8-hourly res/com sweeps (jobid 4/5, unchanged)
-- still refresh each slice's top pages 3x/day, so actively-listed inventory stays current.
--
-- SAFETY UNCHANGED: liveness.py --mode enum-strike keeps grace=3, the collapse guard (>30% dead =>
-- strike nothing), the enum-coverage floor (>=40k rows AND >=85% of the trailing median), the 30-row
-- control group, and the 1500/run confirm cap. A stale or partial enum still means NO strikes --
-- it fails safe in the keep-the-listing direction. The strike step's >36h-stale-enum guard is not
-- tripped by this change: it runs in the SAME workflow run as its enum (needs: enum).
--
-- NOT chosen as the first lever: lowering --pages 2000 would under-enumerate and trip the >=40k
-- coverage floor, stalling the whole lifecycle instead of just slowing it.
--
-- CRON SEMANTICS: '0 21 */2 * *' is day-of-month stepping, so it fires on the 1st, 3rd, ... 31st.
-- After a 31-day month that yields two consecutive days (31st then the 1st) -- harmless here, one
-- extra enum every other month, never a skipped one. A true 48h interval would need a timestamp
-- ledger, not worth the machinery for this.
--
-- REVERT: re-issue the same select with '0 21 * * *'. cron.schedule() upserts by jobname, so this
-- updates jobid 36 in place rather than creating a second job.
select cron.schedule(
  'gh-wasalt-enum-liveness',
  '0 21 */2 * *',
  $$select public.trigger_gh_workflow('wasalt-enum-liveness.yml')$$
);