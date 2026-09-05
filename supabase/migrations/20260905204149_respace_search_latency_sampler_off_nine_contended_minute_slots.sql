-- OWNER-APPROVED (2026-09-05): re-space cron jobid 105, mon-search-latency-sample.
--
-- THE FINDING. P1 alert 1432 (cron_minute_collision) has been open since 2026-09-04 15:59Z.
-- mon_detect_cron_minute_collision() returns 0 only because mon_raise() dedups on an already-open
-- key; the condition was still TRUE. jobid 105 was added on 2026-09-04 by
-- 20260904154219_search_latency_is_watched_continuously_with_load_attribution with the schedule
-- 2,7,12,17,22,27,32,37,42,47,52,57 — twelve five-minute slots dropped onto an already-dense roster,
-- landing on NINE minutes that then held three jobs each:
--   min 7 -> 75,86,105 · 17 -> 34,75,105 · 22 -> 35,50,105 · 27 -> 33,75,105 · 37 -> 40,75,105
--   min 42 -> 84,86,105 · 47 -> 42,75,105 · 52 -> 43,50,105 · 57 -> 75,86,105
-- jobid 105 was present in all nine. The guard exists because overlapping slots wedged the DB on
-- 2026-08-10 (the 522 outage).
--
-- WHAT IS AND IS NOT CHANGED. Only the minute list. The job's command, its detector, the
-- mon_detect_search_latency_degraded() thresholds, the P0 SLO and every other monitoring threshold
-- are untouched, and the FREQUENCY IS PRESERVED EXACTLY: twelve runs per hour before, twelve after.
-- This is a stampede fix, not a sampling reduction — the owner's instruction was explicit that
-- cadence must not drop.
--
-- HOW THE SLOTS WERE CHOSEN, using the detector's OWN expansion logic rather than a fresh one.
-- mon_detect_cron_minute_collision() counts only jobs whose hour field is '*', and raises on
-- `count(*) >= 3 or (minute = 0 and count(*) > 1)`. Measured occupancy EXCLUDING jobid 105 shows
-- only twenty minutes sitting at <= 1, and they cluster: minutes 15-22, 24-28, 34-38 and 41-48 are
-- ALL already at 2. Every chosen minute is at <= 1, so adding this job takes it to 2 — permitted,
-- and two below the raise threshold. Minute 0 is excluded (reserved for the matview refresh) and so
-- are :29/:59, which belong to the detector sweep (jobid 38) — a sampler queued behind a 241s-average
-- sweep is the shape this whole exercise is trying to avoid.
--
-- New schedule: 2,6,9,12,14,23,30,33,40,49,53,56
--   gaps: 4,3,3,2,9,7,3,7,9,4,3,6 (wrap included) — mean 5.0, exactly the old cadence.
-- The 9-minute maxima at 14->23 and 40->49 are STRUCTURALLY FORCED, not sloppiness: there is no
-- minute at <= 1 anywhere in 15-22 or 41-48, so no twelve-slot arrangement on free minutes can do
-- better. A tighter maximum would require displacing another routine's job, which is not this
-- change's to make.
--
-- alter_job rather than unschedule+schedule: it preserves the jobid, command, database, username and
-- active flag, so nothing but the timing can move.

do $$
declare
  v_before text; v_after text; v_minutes int; v_worst int; v_collisions text;
begin
  select schedule into v_before from cron.job where jobid = 105;
  if v_before is null then
    raise exception 'REFUSING: cron jobid 105 not found';
  end if;
  if v_before <> '2,7,12,17,22,27,32,37,42,47,52,57 * * * *' then
    raise exception 'REFUSING: jobid 105 schedule is %, not the one this migration adjudicated. '
                    'Someone else moved it; re-measure before changing it again.', v_before;
  end if;

  perform cron.alter_job(105, schedule => '2,6,9,12,14,23,30,33,40,49,53,56 * * * *');

  select schedule into v_after from cron.job where jobid = 105;
  if v_after <> '2,6,9,12,14,23,30,33,40,49,53,56 * * * *' then
    raise exception 'REFUSING: the schedule change did not take (now %)', v_after;
  end if;

  -- CADENCE FLOOR: twelve runs an hour, before and after. Never fewer.
  v_minutes := array_length(string_to_array(split_part(v_after,' ',1), ','), 1);
  if v_minutes <> 12 then
    raise exception 'REFUSING: new schedule has % slots, not the 12 the old one had', v_minutes;
  end if;

  -- THE INVARIANT, evaluated with the detector's own predicate: no minute may reach three jobs,
  -- and minute 0 may not exceed one.
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
  select coalesce(max(c), 0), string_agg(format('min %s -> %s jobs', minute, c), '; ')
    into v_worst, v_collisions
  from (
    select minute, count(*) as c from expanded group by minute
    having count(*) >= 3 or (minute = 0 and count(*) > 1)
  ) x;

  if v_collisions is not null then
    raise exception 'REFUSING: collisions remain after the move: %', v_collisions;
  end if;

  raise notice 'jobid 105 re-spaced % -> %; 12 slots preserved; no minute at 3+', v_before, v_after;
end $$;
