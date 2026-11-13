-- gh-dealapp-sharded 00:33 → 20:23 UTC (⚡ Scraping Engineer 2026-11-12). The fleet is TWO WAVES.
--
-- dealapp-sharded.yml runs 24 shards with max-parallel 12, so its worst case is 2 × timeout-minutes (250)
-- + the stagger ≈ 504 min, not 250. 20261103052955 read one wave (00:33 + 250 = 04:43) and so did its barrier.
-- Measured: 11-11 median shard 230 min, last shard ended 10:53 UTC; 11-12 at 05:27 UTC 10 dealapp shards
-- still held runners while the 04:22 small-sources nightly's 145 jobs and every engineer PR check sat queued.
--
-- 20:23 + 504 min ≈ 04:47 UTC. Minute :23 of hour 20 holds no other job (mon_detect_cron_minute_collision).
-- The wasalt enumeration (21:09, max-parallel 6) shares the night: 12 + 6 runners fit the pool. The shard
-- coverage detector judges a 30 h window (20261109051047), so the one-off ~20 h gap is not a miss.
-- Barrier: scripts/verify-dealapp-fleet-ends-before-the-engineer-window.ts (now counts waves).
-- Undo: the same call with '33 0 * * *'.
select cron.alter_job(
  job_id   := (select jobid from cron.job where jobname = 'gh-dealapp-sharded'),
  schedule := '23 20 * * *'
);

do $verify$
declare v_sched text; v_active boolean; v_cmd text;
begin
  select schedule, active, command into strict v_sched, v_active, v_cmd
    from cron.job where jobname = 'gh-dealapp-sharded';
  if v_sched <> '23 20 * * *' then raise exception 'gh-dealapp-sharded did not move: %', v_sched; end if;
  if not v_active then raise exception 'gh-dealapp-sharded is inactive'; end if;
  if v_cmd not like '%dealapp-sharded.yml%' then raise exception 'gh-dealapp-sharded command changed: %', v_cmd; end if;
end
$verify$;
