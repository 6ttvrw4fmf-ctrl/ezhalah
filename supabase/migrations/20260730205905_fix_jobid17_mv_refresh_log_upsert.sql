-- P1 fix (senior audit 2026-07-30): migration mon_mv_refresh_log_populate_20260730 (10:13 UTC) created
-- mon_mv_refresh_log with PRIMARY KEY (object_name) — latest-refresh semantics — but jobid 17's hourly
-- command does plain INSERTs. First run (11:00) seeded the rows; every later run hit the dup-key error,
-- and pg_cron's implicit transaction ROLLED BACK the already-executed MV refreshes: active_listing_ids_v2
-- + listing_native_location_v1 frozen at 11:00 (9 failed runs; 0/50 post-13:00 listings in the MV).
-- Fix restores intended behavior: same command with the two INSERTs converted to UPSERTs.
SELECT cron.alter_job(17, command =>
$cmd$set statement_timeout to '900s'; refresh materialized view concurrently public.active_listing_ids_v2; refresh materialized view concurrently public.listing_native_location_v1; analyze public.active_listing_ids_v2; analyze public.listing_native_location_v1; insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note) select 'active_listing_ids_v2', now(), count(*), 'jobid17' from public.active_listing_ids_v2 on conflict (object_name) do update set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note; insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after, note) select 'listing_native_location_v1', now(), count(*), 'jobid17' from public.listing_native_location_v1 on conflict (object_name) do update set refreshed_at = excluded.refreshed_at, rows_after = excluded.rows_after, note = excluded.note;$cmd$);
