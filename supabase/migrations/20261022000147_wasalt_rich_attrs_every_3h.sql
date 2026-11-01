-- Wasalt's rich-attrs sync every 3 hours, not once a day (owner 2026-10-21: «the new listings we are matching it
-- with the map»). Wasalt's pin reaches the served index only through sync_listing_rich_attrs('wasalt_…'), which
-- 20260811104955 put on its own DAILY slot because it is the one costly platform (measured then 18.6 s as a
-- no-op; 36–44 s on 2026-10-19/20/21). At once a day a new Wasalt ad waited up to ~24 h for its pin: on
-- 2026-10-21 23:27 UTC all 855 Wasalt ads first seen in the last 24 h showed a district border. Every 3 hours at
-- :46 (still clear of the :15/:16 pin strips and the :22 index sync, which picks the pins up 36 min later) is
-- ~5 min of this query a day instead of ~40 s, and a new ad waits at most ~3.5 h.
select cron.alter_job((select jobid from cron.job where jobname = 'sync-rich-attrs-wasalt'), schedule := '46 */3 * * *');

do $proof$
begin
  if (select schedule from cron.job where jobname = 'sync-rich-attrs-wasalt') <> '46 */3 * * *' then
    raise exception 'PROOF: sync-rich-attrs-wasalt is not on the 3-hour schedule';
  end if;
end $proof$;
