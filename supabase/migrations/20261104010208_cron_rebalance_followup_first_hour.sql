-- CRON REBALANCE follow-up (owner decision 6, 2026-11-03), from the first hour watched after
-- 20261104000454. Four re-slots, minute only.
--
-- 1. district-recovery-pipeline :43 -> :54. While it ran (00:43:00 -> 00:45:01, 121 s) nothing
--    scheduled for 00:44 started until it finished: rebuild-age-producer, resolve-raghdan-city,
--    mon-p0-fast-lane and mon-cron-starvation-risk all started at 00:45:01. The same hold happened at
--    00:20 behind refresh_listing_native_location_v1, whose last step also calls
--    refresh_district_recovery(). Starts were late by about a minute, none was lost. At :54 the
--    minute after it (:55) holds sync-payment-monthly and mon-aqar-ppm-as-total, not the P0 lane.
-- 2. mon-detectors-and-dispatch's p95 rose from 650 s to 667 s within the hour, which widened its
--    window to :59-:11 and caught the two :11 jobs: strip-far-from-city-pins -> :14 (still 8 min
--    before the :22 sync, contract floor 5, and before the :16 matview refresh) and
--    gh-enrollment-guard-backstop -> :53.
-- 3. sync-search-listings-ar's p95 is 890 s; past 900 s its window reaches :38, so
--    gh-engineer-automerge's :38 slot moves to :39.
-- The layout now survives both windows growing by one more minute.
do $mig$
declare
  r record; v_n int; v_id bigint; v_cur text;
begin
  for r in
    select * from (values
      ('district-recovery-pipeline', '43 * * * *', '54 * * * *'),
      ('strip-far-from-city-pins', '11 * * * *', '14 * * * *'),
      ('gh-enrollment-guard-backstop', '11 * * * *', '53 * * * *'),
      ('gh-engineer-automerge', '12,38,47,56 * * * *', '12,39,47,56 * * * *')
    ) as t(jobname, old_schedule, new_schedule)
  loop
    select count(*), min(jobid), min(schedule) into v_n, v_id, v_cur
      from cron.job where jobname = r.jobname and active;
    if v_n <> 1 or v_cur is distinct from r.old_schedule then
      raise exception '%: % active job(s) on "%", expected one on "%"', r.jobname, v_n, v_cur, r.old_schedule;
    end if;
    perform cron.alter_job(job_id := v_id, schedule := r.new_schedule);
  end loop;

  if exists (select 1 from public.ops_cron_start_instants() where minute = 0) then
    raise exception 'a job starts on minute 0';
  end if;
  if exists (select 1 from public.mon_cron_starved_schedules() where victim_jobname <> 'mon-p0-fast-lane') then
    raise exception 'a job other than mon-p0-fast-lane is inside a hog window';
  end if;
  if exists (select 1 from public.ops_cron_start_instants() group by hour, minute having count(*) > 4) then
    raise exception 'an (hour, minute) starts more than 4 jobs';
  end if;
  if exists (select 1 from public.ops_cron_start_instants() where writer_fn is not null
              group by hour, minute having count(*) >= 2) then
    raise exception 'two single-writer jobs share an (hour, minute)';
  end if;
end
$mig$;