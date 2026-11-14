-- 🔧 2026-11-14: the hourly search-index chain (cron job «sync-search-listings-ar», :22) is SKIPPED by pg_cron about
-- three times a day — no run row at all, nothing failed: 11-13 15:22, 11-13 19:22, 11-14 11:22 (cron_health alert 14774,
-- attendance 87.5 %; the only hourly job that misses, and nothing else is due at :22). Each miss leaves the served index,
-- the counts and the text-facts marker an hour behind: at 11:50 the text-facts detector read 81 wasalt ads whose text had
-- changed before the last marker pass and still served their old facts (P1 14772), and the 12:22 pass cleared all 81.
-- The launcher's reason is pg_cron's (version 1.6.4, only one job running at the missed instant, max_running_jobs 32), so the
-- repair that does not depend on it: a :48 catch-up that runs the SAME chain, in the SAME single-writer lock, ONLY when the
-- :22 tick of this hour never started. When the tick ran (or is still running) it returns in milliseconds and writes nothing.
-- «A detector repairs before it raises» (owner 2026-11-04). The attendance detector keeps counting the misses honestly.
-- The hour is full (every minute already starts 2 hourly jobs, the max_per_instant ratchet), so the catch-up is not a new
-- slot: it is the FIRST statement of the existing :50 job «refresh-district-list-after-sync» (jobid 180), whose whole purpose
-- is to run after the sync. When the tick ran, the catch-up returns in milliseconds and the job goes on as before. The job
-- joins single_writer_jobs in sql/mirrors/cron_schedule.json (it can now take the single-writer lock); its minute does not move.
create or replace function public.sync_search_listings_catch_up()
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_job  bigint;
  v_last timestamptz;
  v_due  timestamptz := date_trunc('hour', now()) + interval '21 minutes';
begin
  select j.jobid into v_job from cron.job j where j.jobname = 'sync-search-listings-ar' and j.active;
  if v_job is null then
    return 'no active sync-search-listings-ar job';
  end if;
  select max(d.start_time) into v_last from cron.job_run_details d where d.jobid = v_job;
  if v_last is not null and v_last >= v_due then
    return format('tick ran at %s', to_char(v_last, 'HH24:MI:SS'));
  end if;
  if exists (select 1 from cron.job_run_details d where d.jobid = v_job and d.status = 'running') then
    return 'tick still running';
  end if;
  -- the :22 tick of this hour never started: run its chain, in its lock, in its order
  perform pg_advisory_xact_lock(hashtext('location_pipeline:v1_refresh'));
  perform public.sync_search_listings_ar();
  perform public.refresh_rnpl_flags();
  perform public.sync_payment_monthly();
  perform public.sync_all_rich_attrs();
  perform public.sync_gathern_native_attrs();
  perform public.refresh_photo_capture_trust();
  perform public.sync_all_listing_photos();
  perform public.sync_raw_land_subtype();
  return format('caught up: the :22 tick never started this hour (last start %s)', coalesce(to_char(v_last, 'MM-DD HH24:MI'), 'never'));
end
$$;
revoke all on function public.sync_search_listings_catch_up() from public, anon, authenticated;

-- the :50 «after sync» job runs the catch-up first, then its own refresh, each under its own budget
select cron.alter_job(
  (select j.jobid from cron.job j where j.jobname = 'refresh-district-list-after-sync' and j.active),
  command := $cmd$set client_min_messages to warning; set statement_timeout to '1500s'; set lock_timeout to '540s'; select public.sync_search_listings_catch_up(); set statement_timeout to '300s'; set lock_timeout to '5s'; select public.refresh_loc_canonical_district();$cmd$
);
