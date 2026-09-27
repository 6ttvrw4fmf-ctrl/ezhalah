-- refresh-mon-audit-counts runs at :14 and :52, off the search sync's minute (2026-09-27, owner-approved).
--
-- Mirror of a schedule change applied live on 2026-09-26 22:44 UTC with cron.alter_job; production
-- already runs '14,52 * * * *', so applying this is a no-op there. It exists so the repo stops saying
-- '22,52' (20260913105239) and nothing re-schedules the job back onto the crash minute.
--
-- WHY. Production restarted four times on 2026-09-26 (memory exhaustion; the host went silent, then
-- rebooted). At :22 this job started in the same second as sync-search-listings-ar (jobid 28), and both
-- make the planner expand listing_native_location_v2 (~270 MB per plan, EXPLAIN (MEMORY)); this job
-- alone needed ~970 MB to plan before 20260926235614 and ~310 MB after. After the move: no restart.
--
-- THE KNOWN COST. :14 already holds mon-search-latency-sample and resolve-amlakalahsa-locations, so it is
-- a three-job minute and mon_detect_cron_minute_collision lists it (that P1 has been open since
-- 2026-09-18 for other minutes). Both co-runners average under 1 s over 24 h. The owner chose memory
-- safety over the start-count rule; 20260902162113's warning that :14 is a trap was about start counts.
-- Every minute outside the detector sweep's shadow already holds two or more jobs.

select cron.schedule('refresh-mon-audit-counts', '14,52 * * * *',
  $$set statement_timeout to '600s'; select public.refresh_mon_audit_counts();$$);

do $$
declare j record;
begin
  select * into strict j from cron.job where jobname = 'refresh-mon-audit-counts';
  if j.schedule <> '14,52 * * * *' then
    raise exception 'refresh-mon-audit-counts schedule is %, expected 14,52 * * * *', j.schedule;
  end if;
  if j.command <> 'set statement_timeout to ''600s''; select public.refresh_mon_audit_counts();' then
    raise exception 'refresh-mon-audit-counts command changed: %', j.command;
  end if;
  if not j.active then
    raise exception 'refresh-mon-audit-counts is inactive';
  end if;
end $$;
