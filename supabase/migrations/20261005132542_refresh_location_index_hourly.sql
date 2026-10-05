-- refresh-location-index (listing_location_index + listing_location_canonical_mv): daily 07:30 → hourly at :15
-- (🔧 Quality & Repair Engineer, 2026-10-05, repair backlog #53 from the 🆕 New Listings Engineer).
-- Why: every phasea platform crawled after 07:30 is absent from listing_location_canonical_mv until the next
-- morning, so it is absent from listing_native_location_v1 (job :20) and search falls back to a region-scoped
-- overlay with district NULL. Measured 2026-10-05: arkaan crawled 05:27, 16 new listings without a district
-- for ~3 h (ids 15495517, 15496347: v1 0 rows, canonical_mv 0 rows at 07:18). The numbers rule wants a new
-- listing fully counted within 1 h.
-- Cost: the job ran 27–66 s on each of the last 5 days (cron.job_run_details jobid 16), both refreshes
-- CONCURRENTLY (readers never block). :15 lands after the :10 district recovery and before the :20 v1
-- refresh that reads it, so the :22 sync carries the district the same hour. Command text unchanged.
-- UNDO: select cron.alter_job(jobid, schedule := '30 7 * * *') from cron.job where jobname = 'refresh-location-index';
do $do$
declare n int;
begin
  perform cron.alter_job(jobid, schedule := '15 * * * *') from cron.job where jobname = 'refresh-location-index';
  select count(*) into n from cron.job where jobname = 'refresh-location-index' and schedule = '15 * * * *'
     and command like '%refresh materialized view concurrently public.listing_location_canonical_mv%';
  if n <> 1 then raise exception 'refresh-location-index not rescheduled (found %)', n; end if;
end
$do$;