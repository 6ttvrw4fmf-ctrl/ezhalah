-- Dealapp liveness every hour instead of every 2 hours (♻️ lifecycle, 2026-10-31).
--
-- Owner rule 2026-10-26/27 (LIFECYCLE_ENGINEER.md «MORE ADS → MORE CHECKS»): when a platform grows,
-- its checking grows with it. The 2-hourly cadence was set for ~20,900 active ads; dealapp now holds
-- 49,052 (ops_platform_liveness_coverage 2026-10-31 10:19 UTC) and reads 73.0% checked inside its 48 h
-- window (35,821). One sweep is bound by dealapp's per-visitor view quota (~9 origin renders a minute,
-- scrapers/dealapp/liveness.py RENDERS_PER_MIN), so a run reads 600 ads in ~50 minutes and a bigger
-- --limit cannot help; only more sweeps can. Each run ends in ~50 minutes (scrape_runs dealapp_liveness
-- 10-30/10-31: 45-50 min), so an hourly dispatch does not stack, and the called workflow's own
-- `concurrency: dealapp-liveness` still serialises any slow one. CI egress only: the paid proxy is not
-- touched (rule 8). Same code, same 600-ad limit, same pacing, same 3-strike law.
do $sched$
begin
  perform cron.alter_job(
    (select jobid from cron.job where jobname = 'gh-dealapp-liveness'),
    schedule := '40 * * * *');
end $sched$;

do $verify$
begin
  if not exists (select 1 from cron.job where jobname = 'gh-dealapp-liveness'
                   and schedule = '40 * * * *' and command like '%dealapp-liveness-cron.yml%') then
    raise exception 'gh-dealapp-liveness is not hourly';
  end if;
  raise notice 'gh-dealapp-liveness hourly';
end $verify$;