-- Retire jazwtn: jazwtn.sa IP-blocks GitHub Actions runner ranges (owner-approved 2026-07-27).
--
-- Its small-sources-sync leg failed 6/6 consecutive runs from 2026-07-23, always on the FIRST
-- request (sitemap_entries -> s.get(SITEMAP), scrapers/jazwtn/run.py:218) with
-- `curl: (35) Recv failure: Connection reset by peer` ~24s in. The identical URL returns HTTP 200
-- / 68,410 bytes in 0.26s from a non-runner IP, so the site is up and the scraper code is correct
-- — only the egress IP is blocked. Same failure class as toor (retired 2026-07-06).
--
-- The 137 active rows are deliberately LEFT ACTIVE and searchable. This migration touches only
-- bookkeeping/monitoring flags; neither table is referenced by sync_search_listings_ar,
-- listing_native_location_v2, capture_crawl_stats, or mark_stale_listings_inactive (verified),
-- so nothing here can hide a listing.

-- 1) Registry: drop jazwtn out of the "active production source" set the nightly audit expects
--    (Query 5 counts status='active' AND kind='source'). Matches toor/alnokhba/deal.
update public.platform_registry
   set status = 'retired'
 where platform = 'jazwtn'
   and status <> 'retired';

-- 2) Cadence: check_scraper_freshness() skips a platform only when platform_cadence.is_active is
--    false. jazwtn has NO cadence row today, so it defaults to expected_hours=24 and would page
--    about staleness forever after retirement. Insert the row the other retired platforms have.
insert into public.platform_cadence (platform, is_active, expected_hours)
values ('jazwtn', false, 24)
on conflict (platform) do update
   set is_active = false;
