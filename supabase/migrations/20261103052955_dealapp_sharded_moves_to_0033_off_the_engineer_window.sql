-- gh-dealapp-sharded 02:33 → 00:33 UTC (⚡ Scraping Engineer 2026-11-03, backlog 1164 runner saturation).
--
-- The 2026-08-11 slot (20260811133612) chose 02:33 because the worst shard took ~97 min, so the fleet
-- finished «comfortably BEFORE gh-small-sources at 04:22». Shards now take up to 231 min (11-01; timeout 250),
-- so the fleet runs 02:33 → ~06:30 and holds up to 12 of the repo's 20 runners across the 04:22 nightly
-- (144 jobs) and the whole 05:00+ engineer window. Measured 11-03 05:30 UTC: 20 of 20 runners busy — dealapp 9,
-- the nightly 3, muktamel 2, gathern 1, CI 5 — and ~70 jobs queued, every engineer proof and PR check among them.
--
-- 00:33 keeps minute :33 (dealapp's own slot; mon_detect_cron_minute_collision unchanged), starts after the
-- every-other-night wasalt enumeration (21:00 → ~00:30), and ends by ~04:25 even on a 231-minute shard. The
-- shard-coverage detector judges a 30 h window since 20261103052507, so the one-off 22 h gap is not a miss.
select cron.alter_job(
  job_id   := (select jobid from cron.job where jobname = 'gh-dealapp-sharded'),
  schedule := '33 0 * * *'
);