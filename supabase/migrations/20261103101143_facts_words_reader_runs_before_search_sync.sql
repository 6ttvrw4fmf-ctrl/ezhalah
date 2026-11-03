-- THE WORD READER FINISHES BEFORE THE SEARCH SYNC, SO A NEW AD REACHES ITS CHIP IN ONE PASS (owner 2026-11-03: «The root ?»).
--
-- Measured 2026-11-03 10:10 UTC: the hourly reader (pg_cron gh-facts-words-nightly) fired at :25 and took 12-13 minutes
-- (one run 22), while the index sync that serves its answers (sync-search-listings-ar) fires at :22. Every read
-- therefore landed just AFTER a sync started and waited for the next one: three Gathern ads read at 09:25:54 with
-- «مجلس» were still unserved at 10:10. A new ad's words took up to about two hours to reach a chip.
-- Minute 01 is quiet (only the 10-minute aqar resolver and the P0 fast lane share it); the run ends near :13, before :22,
-- so the same hour's sync serves it: about one hour from a new ad to its chip. The job keeps its name; only the minute
-- moves. Reversible: cron.alter_job(…, schedule := '25 * * * *').
do $$
declare v_id bigint; n int;
begin
  select jobid into v_id from cron.job where jobname = 'gh-facts-words-nightly';
  if v_id is null then raise exception 'ABORT: pg_cron job gh-facts-words-nightly not found'; end if;
  if (select command from cron.job where jobid = v_id) <> 'select public.trigger_gh_workflow(''facts-words.yml'')' then
    raise exception 'ABORT: gh-facts-words-nightly no longer dispatches facts-words.yml — re-read it before moving its schedule';
  end if;
  perform cron.alter_job(job_id := v_id, schedule := '1 * * * *');
  select count(*) into n from cron.job where jobname = 'gh-facts-words-nightly' and schedule = '1 * * * *' and active;
  if n <> 1 then raise exception 'ABORT: the reader schedule did not move to minute 01'; end if;
end $$;