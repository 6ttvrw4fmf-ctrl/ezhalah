-- Same P1 as 20260730205905, still latent on the OTHER refresh job (daily-engineer 2026-07-30).
--
-- 20260730101305 gave BOTH jobid 17 (hourly) and jobid 16 (daily 07:30) plain INSERTs into
-- mon_mv_refresh_log, which has PRIMARY KEY (object_name). Job 17 fired first, failed 9 consecutive
-- runs on the dup key, and pg_cron's implicit transaction rolled the already-executed MV refreshes
-- back with it — active_listing_ids_v2 + listing_native_location_v1 frozen 11:00→21:00 UTC.
-- 20260730205905 fixed job 17 only.
--
-- Job 16 carries the identical defect and has NOT yet fired with the new command (it last ran
-- 07:30 UTC, before 20260730101305 landed at 10:13). Its next run seeds the two rows and SUCCEEDS;
-- the run after that hits the same dup-key error and rolls back the refreshes, freezing
-- listing_location_index + listing_location_canonical_mv indefinitely.
--
-- Same command, both INSERTs converted to UPSERTs.
SELECT cron.alter_job(16, command =>
$cmd$set statement_timeout to '1200s'; refresh materialized view concurrently public.listing_location_index; refresh materialized view concurrently public.listing_location_canonical_mv; analyze public.listing_location_index; analyze public.listing_location_canonical_mv; insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note) select 'listing_location_index', now(), count(*), 'jobid16' from public.listing_location_index on conflict (object_name) do update set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note; insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note) select 'listing_location_canonical_mv', now(), count(*), 'jobid16' from public.listing_location_canonical_mv on conflict (object_name) do update set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note;$cmd$);
