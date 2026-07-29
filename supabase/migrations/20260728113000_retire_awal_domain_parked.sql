-- Retire awal: awaalun.com lapsed into a GoDaddy domain-parking page (owner-approved 2026-07-28).
--
-- Same failure class as alnokhba (retired 2026-07-14) — the domain, not the scraper, is gone:
--   GET https://awaalun.com/wp-json/wp/v2/rtcl_listing?per_page=50&page=1
--     -> HTTP 200, content-type text/html, 133 bytes:
--        <script>window.onload=function(){window.location.href="/lander?..."}</script>
--   /lander serves window._trfd.push({ap:"parking"}), LANDER_SYSTEM="PW", NS DOMAINCONTROL.COM.
-- Individual listing URLs are dead the same way (114-byte stub, verified on a live ad_number).
-- Last successful scrape: 2026-07-26 04:23 (rows_seen=128). 07-27 and 07-28 failed.
--
-- The 51 active rows (44 residential + 7 commercial) are deliberately LEFT ACTIVE and searchable
-- pending a separate owner call on link rot — retire stops the scraper and silences monitoring, it
-- does not delete listings ([[project_inactive-stock-verification-2026-07-26]]: false-alive beats
-- false-kill). This migration touches only bookkeeping/monitoring flags; neither platform_registry
-- nor platform_cadence nor deprecated_platforms is referenced by sync_search_listings_ar,
-- listing_native_location_v2, capture_crawl_stats, or mark_stale_listings_inactive, so nothing
-- here can hide a listing.

-- 1) Registry: drop awal out of the "active production source" set the nightly audit expects
--    (Query 5 counts status='active' AND kind='source'). Matches toor/alnokhba/deal/jazwtn.
update public.platform_registry
   set status = 'retired'
 where platform = 'awal'
   and status <> 'retired';

-- 2) Cadence: check_scraper_freshness() skips a platform only when platform_cadence.is_active is
--    false. awal has NO cadence row today, so it defaults to expected_hours=24 and would page about
--    staleness forever after retirement — exactly the 46 duplicate alerts alnokhba fired and the 58
--    toor fired before they got this row.
insert into public.platform_cadence (platform, is_active, expected_hours, note)
values ('awal', false, 24,
        'retired 2026-07-28 (awaalun.com lapsed to a GoDaddy parking page; removed from '
        'small-sources-sync.yml) — excluded from check_scraper_freshness')
on conflict (platform) do update
   set is_active = false,
       note = excluded.note;

-- 3) Deprecation record, same shape as alnokhba/toor.
insert into public.deprecated_platforms (platform, reason)
values ('awal',
        'Source domain awaalun.com has lapsed into a GoDaddy domain-parking page. Verified '
        '2026-07-28: the WP REST endpoint /wp-json/wp/v2/rtcl_listing and individual /property/ '
        'URLs both return HTTP 200 but the body is a 114-133 byte redirect stub to /lander, which '
        'serves a parking placeholder (window._trfd ap:"parking", LANDER_SYSTEM="PW", NS '
        'DOMAINCONTROL.COM) — reachable, but serves no listing content. Last successful content '
        'pull was 2026-07-26 04:23 UTC (rows_seen=128); 2026-07-27 and 2026-07-28 crashed on '
        'JSONDecodeError before begin_run, which is why they left zero scrape_runs rows (fixed in '
        'PR #250 — the run now records ok=false). Tables and the 51 active rows are RETAINED. Do '
        'not re-add without confirming the domain serves real listings again.')
on conflict (platform) do update set reason = excluded.reason;
