-- Root cause: cron.max_running_jobs=32 but max_worker_processes=6 (max_parallel_workers=2
-- draws from the same pool). pg_cron launches each due job as a background worker; when more
-- jobs share a minute than there are free slots, the losers fail with "job startup timeout".
-- Trigger: 6 new jobs added 2026-08-09/10 (57,61,62,58,59,60) pushed peak same-minute
-- concurrency past the slot budget. First burst 2026-08-09 16:15, 17 min after jobid 61 went live.
--
-- Fix: move MONITOR/DETECTOR jobs only (no pipeline-ordering dependency, no data semantics)
-- off the proven-hot minutes :15 :20 :35 :45 :50 :00. Frequency is unchanged for every job.
-- Pipeline jobs (28 sync-search, 25/35/41/54/55/57/61 resolvers, 22 loc-rel, 45 district-recovery)
-- are deliberately NOT touched so ordering is preserved.

select cron.alter_job(33, schedule => '27 * * * *');      -- novel-type-alarm        :15 -> :27
select cron.alter_job(38, schedule => '26,56 * * * *');   -- mon-detectors-dispatch  :20,:50 -> :26,:56
select cron.alter_job(40, schedule => '37 * * * *');      -- wasalt-enrich-backlog   :35 -> :37
select cron.alter_job(42, schedule => '47 * * * *');      -- mon-price-fidelity      :45 -> :47
select cron.alter_job(43, schedule => '52 * * * *');      -- mon-district-resolution :50 -> :52
select cron.alter_job(50, schedule => '2,32 * * * *');    -- refresh-mon-audit-counts */30 -> :02,:32

