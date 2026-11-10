-- ♻️ 2026-11-10: hide nowaisiry NW4349 (nowaisiry_commercial_listings 646429), whose OWN post reads gone
-- to two independent readers: the crawl's prune oracle (scrapers/nowaisiry/run.py::_make_prune_verify,
-- /?p=4349 → HTTP 404, ledger GONE 2026-11-04 12:42 and 2026-11-07 09:41) AND tonight's dead-visible
-- score (09:05 UTC, site-oracle by post id, gone) plus lifecycle-spot-check on the same id. Its stored
-- slug was re-used by the office for post 4513 (another farm, held as NW4513), which is why the cleanup
-- revived it on 2026-11-10 06:14; that reader is fixed in PR #11656. Absent from nowaisiry's own list
-- since 2026-09-20. Registered in ops_adjudicated_retraction first so neither
-- auto_recover_false_inactive() nor a crawl upsert can switch it back on.
set local lock_timeout = '5s';

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select 'nowaisiry_commercial_listings', t.id,
       'lifecycle 2026-11-10: nowaisiry ad read gone on its own post id by two readers (prune oracle 404 + dead-visible score 11-10)',
       jsonb_build_object('ad_number', t.ad_number, 'listing_url', t.listing_url,
                          'own_id_url', 'https://alnowaisiry.com/?p=4349',
                          'strikes_before', t.missing_count, 'last_seen_at', t.last_seen_at,
                          'migration', 'nowaisiry_hide_nw4349_read_gone_by_own_post_id',
                          'watched_by', 'mon_detect_adjudicated_reactivation')
from public.nowaisiry_commercial_listings t
where t.active
  and t.id = 646429
  and t.ad_number = 'NW4349'
  and t.last_seen_at < '2026-10-01'
  and not exists (select 1 from public.ops_adjudicated_retraction r
                   where r.source_table = 'nowaisiry_commercial_listings' and r.listing_id = t.id);

update public.nowaisiry_commercial_listings t
   set active = false, deactivated_at = now()
 where t.active
   and t.id = 646429
   and exists (select 1 from public.ops_adjudicated_retraction r
                where r.source_table = 'nowaisiry_commercial_listings' and r.listing_id = t.id
                  and r.reason like 'lifecycle 2026-11-10: nowaisiry ad read gone on its own post id%');
