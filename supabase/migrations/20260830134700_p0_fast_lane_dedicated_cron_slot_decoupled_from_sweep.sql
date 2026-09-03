-- Systems Seam, 2026-08-30. OWNER DECISION: decouple the P0 fast lane from the detector sweep.
--
-- THE DEFECT THIS FIXES (measured, not theorised). alert_event.created_at defaults to now() =
-- TRANSACTION START, and mon_dispatch_p0_fast() ran only chained to the mon-detectors-and-dispatch
-- command. So the ENTIRE sweep runtime was charged against the owner's 300s P0 SLO before dispatch
-- even began. Observed: the 05:29 sweep ran 356.8s; P0 alert 1166 was created 05:29:00 and its
-- issue was filed 05:35:11 -> 371s end-to-end, a 71s breach. The sweep is a shared, unbounded cost
-- that a P0's delivery clock should never have depended on.
--
-- THE OWNER'S INSTRUCTION (2026-08-30, verbatim intent): decouple the fast lane from the full
-- sweep; KEEP the 5-minute SLO exactly as it is; give the fast lane its own dedicated cron slot so
-- long-running detectors cannot consume the SLO budget before dispatch starts; do NOT weaken or
-- extend the 300s SLO to make the metric green; PRESERVE the existing full sweep.
--
-- WHY THE PREVIOUS "THIS IS IMPOSSIBLE" CONCLUSION WAS WRONG, so nobody re-derives it.
-- 20260828231336 unscheduled the original '* * * * *' job and recorded that "exactly TWO
-- minute-slots in the hour are free (24 and 42), so NO polling schedule can satisfy both the
-- 5-minute SLO and the slot discipline." That rested on "free" meaning "zero jobs on that minute".
-- It is not what the gate actually enforces. mon_detect_cron_minute_collision() raises only on
--     having count(*) >= 3 or (minute = 0 and count(*) > 1)
-- i.e. TWO hourly jobs per minute are permitted, and minute 0 alone is reserved (for the matview
-- refresh). It also counts ONLY jobs whose hour field is '*' — daily jobs like '30 2 * * *' are not
-- counted at all. Measured on the live roster today: 49 of 60 minutes sit at <= 1 hourly job and can
-- therefore accept one more. The design space was never two slots; it was forty-nine.
--
-- THE SCHEDULE, and why each minute is in it. 24 slots with a MAXIMUM GAP OF 3 MINUTES anywhere in
-- the hour, including the wrap from :58 back to :01. Every chosen minute currently carries <= 1
-- hourly job, so adding this one takes it to at most 2 and never to the 3 that raises. Excluded:
--   * minute 0                      -- reserved for the matview refresh alone
--   * 16,17,25,27,36,37,41,43,45,47 -- already at 2; a third would raise cron_minute_collision
--   * 29 and 59                     -- the sweep's own minutes. Legal (they sit at 1), but piling
--                                      the lane onto the start of the heaviest job in the system is
--                                      exactly the contention this decoupling exists to remove.
--
-- THE SLO ARITHMETIC. Worst case a P0 waits 180s for the next slot. Filing then costs ~15-20s
-- (measured: alert 1166's fast-lane POST at 05:34:56 -> issue at 05:35:11 = 15s). Worst case
-- ~200s against a 300s budget, and the sweep's duration is no longer a term in it at all. The SLO
-- is UNCHANGED at 5 minutes; what changed is that the delivery path can now actually meet it.
--
-- THE SWEEP IS PRESERVED, AND STILL CALLS THE LANE. mon-detectors-and-dispatch is untouched: same
-- '29,59' schedule, same detectors, same leading and trailing mon_dispatch_p0_fast() calls. Those
-- calls are now defence-in-depth rather than the only path — in particular the LEADING call is what
-- survives a sweep that aborts on statement_timeout and rolls its trailing call back. Decoupled
-- means the SLO no longer DEPENDS on the sweep, not that the sweep stops helping.
--
-- NO NEW DUPLICATE RISK. mon_dispatch_p0_fast() is unchanged and already guards re-triggering three
-- ways: it skips an alert with an unsettled in-flight request (request_id set, settled_at null),
-- skips one tried inside c_retrigger_after (3 minutes), and stops at c_max_attempts (3). Downstream,
-- alert-dispatch.yml dedups on the '[alert] <dedup_key>' issue title. The lane is also a cheap
-- no-op on the vast majority of runs: it early-exits on a single count when no P0 is pending.

do $$
begin
  perform cron.unschedule('mon-p0-fast-lane');
exception when others then
  null;  -- not scheduled yet; first application
end $$;

select cron.schedule(
  'mon-p0-fast-lane',
  '1,4,7,10,13,15,18,21,24,26,28,31,34,35,38,40,42,44,46,48,51,54,57,58 * * * *',
  $cmd$
    set statement_timeout to '45s';
    select public.mon_dispatch_p0_fast();
  $cmd$
);
