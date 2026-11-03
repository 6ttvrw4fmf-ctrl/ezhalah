-- THE FREE WORD READER RUNS EVERY HOUR, NOT ONCE A NIGHT (owner 2026-11-03: «make sure the root … whenever we get a new
-- listing the description immediately matches»; owner left the cadence to the engineer: «your choice»).
--
-- Measured 2026-11-03 00:35 UTC before this change: the incremental phase of facts-words.yml (pg_cron job
-- gh-facts-words-nightly → trigger_gh_workflow('facts-words.yml')) ran once a day at 07:05 UTC, so a new ad waited up to
-- ~24 h before its own words could put it under a chip (99 ads were waiting; 3,430 of the last 24 h's 3,529 were read).
-- One incremental run reads only active ads that are new or whose text changed (text_facts_todo) and took 11–13 minutes;
-- zero paid AI calls (Actions minutes only). The workflow's concurrency group queues a run behind a running one
-- (cancel-in-progress: false), so an hourly cadence cannot stack runs. The hourly index sync already merges the overlay
-- into search_listings_ar under Rule B, so a new ad now reaches its chip within about an hour.
--
-- Minute 25: clear of the detector sweep at :29/:59 and the top-of-hour jobs. The job keeps its name (monitors and docs
-- refer to it); only the schedule moves. Reversible: cron.alter_job(…, schedule := '5 7 * * *').
do $$
declare v_id bigint; n int;
begin
  select jobid into v_id from cron.job where jobname = 'gh-facts-words-nightly';
  if v_id is null then raise exception 'ABORT: pg_cron job gh-facts-words-nightly not found'; end if;
  if (select command from cron.job where jobid = v_id) <> 'select public.trigger_gh_workflow(''facts-words.yml'')' then
    raise exception 'ABORT: gh-facts-words-nightly no longer dispatches facts-words.yml — re-read it before moving its schedule';
  end if;
  perform cron.alter_job(job_id := v_id, schedule := '25 * * * *');
  select count(*) into n from cron.job where jobname = 'gh-facts-words-nightly' and schedule = '25 * * * *' and active;
  if n <> 1 then raise exception 'ABORT: the reader schedule did not move to hourly'; end if;
end $$;
