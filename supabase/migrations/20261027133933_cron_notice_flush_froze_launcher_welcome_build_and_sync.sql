-- 913 (🔧 Quality & Repair, 2026-10-27): two cron jobs froze the pg_cron launcher for every other job.
-- Measured 2026-10-27 (cron.job_run_details): the 3-hourly welcome build (job 185) held the four other :45 jobs
-- (29, 44, 141, 174) until its own end second at 06:46:50, 09:46:54 and 12:46:53 and the every-minute job 86
-- started 50-53 s late; the hourly search sync (job 28) did the same at :22→:23:53 and :31:00→:31:40 every hour
-- (31 late starts of job 86 in 24 h, all at :23/:31/:46). Mechanism, reproduced with one-off jobs 194-197 at
-- 13:36/13:39 UTC: a multi-statement job command keeps its early results (the SETs) in the backend's output
-- buffer until a NOTICE flushes them — the build opens with `drop table if exists w_b, …` (7 «does not exist,
-- skipping» notices), the sync's sub-functions notice as they go — and once the launcher has read the first
-- result it blocks in PQgetResult until the next flush or the end of the command. A `select 1` canary scheduled
-- beside the build-shaped job «ended» at the job's end second; beside the same job opened with
-- `set client_min_messages to warning` it ended at once. Job 38 (mon-detectors) has carried that opener since the
-- 10-07 lesson. Same opener here; the commands are otherwise unchanged.
select cron.alter_job(185, command := $$set client_min_messages to warning; set statement_timeout to '900s'; set default_transaction_isolation to 'repeatable read'; select public.run_welcome_build();$$);
select cron.alter_job(28, command := $$set client_min_messages to warning; set statement_timeout to '600s'; set lock_timeout to '540s'; select pg_advisory_xact_lock(hashtext('location_pipeline:v1_refresh')); set lock_timeout to '0'; set statement_timeout to '600s'; select * from public.sync_search_listings_ar(); select public.refresh_rnpl_flags(); select public.sync_payment_monthly(); select * from public.sync_all_rich_attrs(); select public.sync_gathern_native_attrs(); select public.refresh_photo_capture_trust(); select * from public.sync_all_listing_photos(); select public.sync_raw_land_subtype();$$);