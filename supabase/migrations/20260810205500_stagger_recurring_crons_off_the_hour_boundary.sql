-- CRON PILE-UP AT THE HOUR BOUNDARY (production incident, 2026-08-10 ~20:00 UTC).
-- Mirror of the applied migration (the DB is authoritative).
--
-- The project went Unhealthy: the API returned Cloudflare 522, user searches took >25s or were
-- killed, and the postgres log filled with `canceling statement due to statement timeout`.
--
-- Cause: a `*/N` schedule ALWAYS includes minute 0, so five recurring jobs landed on the hour
-- boundary together, alongside the heaviest job of all:
--     job 17  0 * * * *   refresh materialized view active_listing_ids_v2   <- heavy
--     job 25  */10        resolve_aqar_locations
--     job 35  */10        resolve_english_city_overlay
--     job 22  */15        loc_rel_refresh_tick
--     job 65  */20        mon_scan_pii_capture_batch
-- Durations logged that hour: sync_search_listings_ar 118s, district_recovery 46s,
-- location_pipeline_monitor 37s, refresh_rnpl_flags 31s, propagate_dealapp 23s, checkpoint 261s.
-- On the then-current t4g.small (2 SHARED vCPU / 2 GB against a 3.9 GB database) that convoy
-- consumed the instance and starved user queries.
--
-- Compute was raised to m6g.large (dedicated CPU, 8 GB) during the incident, which removed the
-- immediate pressure — but a bigger machine only HIDES a scheduling collision. This removes it.
--
-- Offsets come from the slots actually free in the existing /10 family (3,5,6,7,8 were taken by
-- jobs 41/57, 44, 54, 55, 61). Cadence is preserved exactly; only the PHASE moves.
-- Uses cron.alter_job(): direct UPDATE on cron.job is denied to the migration role.
do $mig$
declare
  r record;
  ids  bigint[] := array[25, 35, 22, 65, 57];
  scds text[]   := array['1-59/10 * * * *',   -- was */10  (0,10,20,…) -> 1,11,21,…
                         '2-59/10 * * * *',   -- was */10             -> 2,12,22,…
                         '4-59/15 * * * *',   -- was */15  (0,15,30,…)-> 4,19,34,49
                         '12-59/20 * * * *',  -- was */20  (0,20,40)  -> 12,32,52
                         '9-59/10 * * * *'];  -- shared 3-59/10 with job 41 -> 9,19,29,…
  i int;
begin
  for i in 1 .. array_length(ids,1) loop
    if exists (select 1 from cron.job where jobid = ids[i]) then
      perform cron.alter_job(job_id := ids[i], schedule := scds[i]);
    else
      raise notice 'cron job % not present — skipped', ids[i];
    end if;
  end loop;

  -- job 17 (hourly matview refresh) deliberately KEEPS minute 0: it is the freshness anchor the
  -- search index depends on and must run before sync_search_listings_ar at :14.

  -- Verify (1): no two ACTIVE jobs may share an identical schedule.
  for r in
    select schedule, count(*) n, string_agg(jobid::text, ',' order by jobid) j
    from cron.job where active group by schedule having count(*) > 1
  loop
    raise exception 'jobs % still share schedule %', r.j, r.schedule;
  end loop;

  -- Verify (2): of the jobs that run EVERY hour (hour field = '*'), only job 17 may touch minute 0.
  -- Daily/weekly jobs pinned to a specific hour are irrelevant to the hourly convoy.
  for r in
    select jobid, schedule from cron.job
    where active and jobid <> 17
      and split_part(schedule,' ',2) = '*'
      and (split_part(schedule,' ',1) like '*/%' or split_part(schedule,' ',1) = '0')
  loop
    raise exception 'hourly job % (%) still fires on minute 0', r.jobid, r.schedule;
  end loop;
end
$mig$;
