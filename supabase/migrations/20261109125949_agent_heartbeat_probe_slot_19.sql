-- 2026-11-09 — agent-heartbeat-probe moves from :11 to :19 of every sixth hour.
-- :11 put three jobs on one (hour, minute) at 00/06/12/18 (owner decision 6, 2026-11-03: at most two);
-- :19 is a free instant outside every hog window and every single-writer window
-- (scripts/lib/cronSlots.ts predicates, run against sql/mirrors/cron_schedule.json before this apply).
select cron.unschedule(jobid) from cron.job where jobname = 'agent-heartbeat-probe';
select cron.schedule('agent-heartbeat-probe', '19 */6 * * *', $j$select public.agent_heartbeat_probe()$j$);
