-- ♻️ 2026-11-08: hide the 27 shown aqargate ads that did not move to aqargate's new site (owner order 2026-11-07
-- «ALL LINKS MUST WORK WHEN A USER CLICKS»: a dead link is hidden through the liveness path, with evidence).
-- aqargate.com replaced its WordPress site with a single-page app on ~2026-11-05 (scrapers/aqargate/run.py). Every ad
-- it kept was imported into the new catalogue with its WordPress post id (regaData.wp_id) or matched by REGA licence,
-- and our crawl moved those rows to /marketplace/<id>. These 27 kept their old /property/<slug>/ address because:
--   1. the new public catalogue, walked COMPLETE on 2026-11-08 11:4x UTC (GET /api/public/listings, 206 of 206 records,
--      122 carrying a wp_id), holds none of their WordPress post ids (AG51540 … AG57393);
--   2. their own stored URL renders the site's own «404 Page Not Found» in a real browser, and answered HTTP 500 to
--      lifecycle-spot-check 42475102564 (site-oracle, known-live controls 5/5 alive) on 2 attempts each;
--   3. they missed 5 complete crawls (missing_count 5, last seen 2026-11-05 04:50 UTC) while still on screen, because
--      their WordPress oracle (/wp-json/wp/v2/properties/<id>) now answers 500 for every id and can never say gone
--      (alert served_after_source_gone:aqargate_residential_listings, 27 production_ready).
-- Registered in ops_adjudicated_retraction first, so auto_recover_false_inactive() cannot undo the decision; if any of
-- them is re-published, the crawl's wp_id / licence match re-links it under its own ad number and the adjudication
-- watch (mon_detect_adjudicated_reactivation) reports it.
set local lock_timeout = '5s';

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select 'aqargate_residential_listings', t.id,
       'lifecycle 2026-11-08: aqargate moved to a new site; this WordPress ad is absent from the complete new catalogue (206/206, no wp_id match) and its own URL renders the site 404 (HTTP 500 to the spot check, controls 5/5)',
       jsonb_build_object('ad_number', t.ad_number, 'listing_url', t.listing_url,
                          'catalogue_walk', 'GET https://aqargate.com/api/public/listings 2026-11-08: 206 of 206, 122 wp_id',
                          'spot_check', 'lifecycle-spot-check 42475102564: HTTP 500 x2, controls 5/5',
                          'migration', '20261108114500_aqargate_hide_27_wordpress_ads_left_the_new_site',
                          'watched_by', 'mon_detect_adjudicated_reactivation')
from public.aqargate_residential_listings t
where t.active
  and t.id in (583349, 583350, 583353, 583355, 583357, 583358, 583359, 583401, 583402, 583407, 583408, 583466, 583467,
               583468, 583469, 583470, 583471, 784774, 928023, 1120877, 2290724, 2290725, 12528751, 12528752, 12528753,
               12528754, 15030493)
  and t.listing_url like 'https://aqargate.com/property/%'
  and not exists (select 1 from public.ops_adjudicated_retraction r
                   where r.source_table = 'aqargate_residential_listings' and r.listing_id = t.id);

update public.aqargate_residential_listings t
   set active = false, deactivated_at = now()
 where t.active
   and t.listing_url like 'https://aqargate.com/property/%'
   and exists (select 1 from public.ops_adjudicated_retraction r
                where r.source_table = 'aqargate_residential_listings' and r.listing_id = t.id
                  and r.reason like 'lifecycle 2026-11-08: aqargate moved to a new site%');
