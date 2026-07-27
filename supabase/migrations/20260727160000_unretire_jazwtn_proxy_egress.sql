-- Un-retire jazwtn (owner-instructed 2026-07-27, same day as the retirement).
--
-- 20260727140000_retire_jazwtn_ip_blocked.sql retired jazwtn because jazwtn.sa TCP-resets GitHub
-- Actions runner IPs (6/6 failed runs since 07-23) and — per its own note — "un-retiring requires
-- a non-runner egress IP (residential proxy), not just re-adding the matrix line". PR#230 shipped
-- exactly that missing piece the same day: scrapers/jazwtn/run.py now routes through the same
-- Saudi residential proxy the souq24/wasalt legs already use (JAZWTN_PROXY_URL / SCRAPE_PROXY_URL
-- / WASALT_PROXY_URL), and begin_run() now precedes the sitemap fetch, so any future re-block
-- fails LOUDLY in scrape_runs instead of silently (the original outage produced zero monitoring
-- rows for 4 days). The matrix line returns in the same PR; if the leg fails again WITH the
-- proxy, re-retire — the code path is then genuinely dead.

update public.platform_registry
   set status = 'active'
 where platform = 'jazwtn'
   and status = 'retired';

update public.platform_cadence
   set is_active = true,
       expected_hours = 24
 where platform = 'jazwtn';
