-- 🔧 2026-11-08: the P0 fast lane asks «is the sweep running?» AFTER its loop, so a sweep that commits during the lane
-- reads as «no sweep running» and a harmless deferral is reported as a crashed detector (p0_lane_detector_unavailable).
--
-- Measured: all 7 raises in 7 days (12589, 12593, 12599, 12608, 12611, 12645, 13890) are a lane tick at :04 or :07 that
-- started while the hourly sweep (jobid 38, one transaction, 7–10 min) was in its last 4–13 seconds: the detector hit its
-- 2 s lock_timeout on an alert_event row the sweep held, the lane went on through the other detectors, and by the time
-- it probed cron.job_run_details the sweep had committed (status 'succeeded'), so the probe said false and the lane
-- raised «lock_timeout with no sweep running». Each one self-resolved three minutes later — a flap, by construction.
-- The probe now also counts a sweep that ENDED after this lane began (v_t0), which is exactly the holder it waited on.
-- Nothing else in the lane changes; a deferral with no such sweep is still loud, as before.
do $$
declare
  d  text;
  d2 text;
  a_decl constant text := E'  v_sweep_on  boolean;\nbegin';
  a_probe constant text := E'    select exists (select 1 from cron.job_run_details\n                    where jobid = 38 and status = ''running'') into v_sweep_on;';
begin
  select pg_get_functiondef('public.mon_run_p0_detectors'::regproc) into d;
  if position(a_decl in d) = 0 then raise exception 'declare anchor not found — re-read mon_run_p0_detectors before editing'; end if;
  if position(a_probe in d) = 0 then raise exception 'probe anchor not found — re-read mon_run_p0_detectors before editing'; end if;
  d2 := replace(d, a_decl, E'  v_sweep_on  boolean;\n  v_t0        timestamptz := clock_timestamp(); -- 2026-11-08: a sweep that ends after this instant held the rows we deferred on\nbegin');
  d2 := replace(d2, a_probe, E'    select exists (select 1 from cron.job_run_details\n                    where jobid = 38 and start_time <= clock_timestamp()\n                      and (status = ''running'' or end_time >= v_t0)) into v_sweep_on;');
  if d2 = d then raise exception 'nothing replaced'; end if;
  execute d2;
  raise notice 'mon_run_p0_detectors: sweep probe now counts a sweep that ended after the lane began';
end $$;

-- PROOF (pure reads): the live body carries the new probe and the start stamp, and no longer the old probe.
do $$
declare d text;
begin
  select pg_get_functiondef('public.mon_run_p0_detectors'::regproc) into d;
  if d !~ 'end_time >= v_t0' or d !~ 'v_t0\s+timestamptz := clock_timestamp\(\)' then
    raise exception 'proof: new probe missing';
  end if;
  if d ~ E'jobid = 38 and status = ''running''\\) into v_sweep_on' then
    raise exception 'proof: old probe still present';
  end if;
  raise notice 'proof ok: fast lane reads a sweep that overlapped its run as the lock holder';
end $$;
