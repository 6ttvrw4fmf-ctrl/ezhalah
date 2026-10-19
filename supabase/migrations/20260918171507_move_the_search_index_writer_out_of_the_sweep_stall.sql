-- OWNER-APPROVED (2026-09-18, in session): move jobs 28 and 40 off the minutes the detector sweep
-- swallows. The cron_scheduler_frozen action text calls a schedule change owner-only; the owner gave
-- that approval explicitly after being shown the measurements below.
--
-- WHY. jobid 28 `sync-search-listings-ar` is the ONLY writer of the served search index. It last ran
-- 2026-09-15 09:36Z. jobid 40 `wasalt-enrich-backlog-monitor` — the watchdog over the wasalt Arabic
-- enrichment backlog (ops_incident #307) — last ran 09:37Z. Neither is broken, and neither was
-- dropped from pg_cron's list: the :29/:59 detector sweep holds the pg_cron LAUNCHER for ~10-11
-- minutes, and :36/:37 fall inside that window every single hour, so their slot never arrives.
--
-- Measured three times on 2026-09-18, each a TOTAL stall (job 86, normally every 2-3 minutes,
-- launched nothing either):
--     12:29:00 -> 12:39:41
--     13:29:00 -> 13:40:18
--     14:29:00 -> 14:39:00+
-- select date_trunc('minute',start_time), count(*) from cron.job_run_details
--  where start_time between '2026-09-18 14:28' and '2026-09-18 14:39' group by 1
--     -> ONLY 14:28 (jobs 61,86) and 14:29 (job 38). Nothing else in eleven minutes.
--
-- pg_reload_conf() does NOT fix this and was tried twice (12:57, 13:40). jobid 109 recovered from
-- the first reload only because :08 sits OUTSIDE the stall. That asymmetry is the proof: the jobs
-- inside the window stay dead, the one outside it comes back.
--
-- The cost of leaving it: the served index froze for 75 hours and the catch-up sync reported
-- upserted=173522 deleted=2673 — 173,522 stale or missing rows and 2,673 listings our own source
-- checks had already marked inactive, still being shown to users. ~22,000 rows of real churn pass
-- through this writer every hour.
--
-- WHY THESE MINUTES.
--   :22 for job 28 — after refresh_listing_native_location_v1 at :20 (so the writer reads a
--        2-minute-old matview, the freshest it can get) and seven minutes clear of the :29 sweep.
--   :03 for job 40 — a monitor, so matview freshness is irrelevant; :03 is far from both sweeps.
--
-- THIRD CHANGE, and it is NOT cosmetic. mon_detect_cron_minute_collision was ALREADY RAISED (P1,
-- open) before this migration: jobid 132 `mon-alert-flapping`, created earlier today, landed on
-- minutes 21 and 51, which already carried two hourly jobs each, making three. The first attempt at
-- this migration ABORTED on its own proof because of that pre-existing collision — the guard worked.
-- Moving it to 2,32 (counts 1 and 0) clears the standing P1 and leaves every minute under the
-- threshold. The detector it runs is unaffected; only its minutes change.
--
-- This does NOT remove the underlying defect: a sweep that can hold the launcher for 11 minutes is
-- still a latent hazard for anything else scheduled in that window. That remains ops_incident #300 /
-- #320, owned by routine-7-seam. This change takes the search index out of its blast radius.

select cron.alter_job(28,  schedule => '22 * * * *');
select cron.alter_job(40,  schedule => '3 * * * *');
select cron.alter_job(132, schedule => '2,32 * * * *');

-- pg_cron reads cron.job into memory; make it re-read now rather than at some unspecified later point.
select pg_reload_conf();

do $proof$
declare
  v_28      text;
  v_40      text;
  v_132     text;
  v_detail  text;
begin
  select schedule into v_28  from cron.job where jobid = 28;
  select schedule into v_40  from cron.job where jobid = 40;
  select schedule into v_132 from cron.job where jobid = 132;

  if v_28 <> '22 * * * *' then
    raise exception 'PROOF FAILED: job 28 schedule is %, expected 22 * * * *', v_28;
  end if;
  if v_40 <> '3 * * * *' then
    raise exception 'PROOF FAILED: job 40 schedule is %, expected 3 * * * *', v_40;
  end if;
  if v_132 <> '2,32 * * * *' then
    raise exception 'PROOF FAILED: job 132 schedule is %, expected 2,32 * * * *', v_132;
  end if;

  -- THE REGRESSION THAT COST 75 HOURS: neither restored job may sit in the sweep stall window.
  if split_part(v_28,' ',1)::int between 29 and 40 then
    raise exception 'PROOF FAILED: the search index writer is back inside the :29 stall window';
  end if;
  if split_part(v_40,' ',1)::int between 29 and 40 then
    raise exception 'PROOF FAILED: the enrich backlog monitor is back inside the :29 stall window';
  end if;

  -- And no minute may carry 3+ hourly jobs (or >1 on :00). Same expansion mon_detect_cron_minute_
  -- collision uses, so this cannot disagree with the detector.
  with hourly_jobs as (
    select jobid, split_part(schedule,' ',1) as min_f
    from cron.job where active and split_part(schedule,' ',2) = '*'
  ),
  expanded as (
    select j.jobid, m.minute
    from hourly_jobs j cross join generate_series(0,59) m(minute)
    where (j.min_f = '*')
       or (j.min_f ~ '^\d+$' and m.minute = j.min_f::int)
       or (j.min_f ~ '^\d+(,\d+)+$' and m.minute::text = any(string_to_array(j.min_f,',')))
       or (j.min_f ~ '^\*/\d+$' and m.minute % split_part(j.min_f,'/',2)::int = 0)
       or (j.min_f ~ '^\d+-59/\d+$' and m.minute >= split_part(j.min_f,'-',1)::int
           and (m.minute - split_part(j.min_f,'-',1)::int) % split_part(j.min_f,'/',2)::int = 0)
  )
  select string_agg(format('min %s -> %s jobs', minute, c), '; ')
    into v_detail
  from (
    select minute, count(*) as c from expanded group by minute
    having count(*) >= 3 or (minute = 0 and count(*) > 1)
  ) x;

  if v_detail is not null then
    raise exception 'PROOF FAILED: a cron minute collision remains: %', v_detail;
  end if;
end
$proof$;
