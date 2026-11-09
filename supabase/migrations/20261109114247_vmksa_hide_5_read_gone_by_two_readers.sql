-- ♻️ 2026-11-09: hide 5 shown vmksa ads whose own page read gone to two independent readers:
-- the crawl's prune oracle (scrapers/vmksa/run.py::_make_verify_gone — the ad's own object = live,
-- Next's NEXT_NOT_FOUND = gone; complete-index crawls 11-07 and 11-09 struck VMK701/702/801/886 twice,
-- VMK703 once) AND lifecycle-spot-check 42610690403 (same oracle, known-live controls 5/5 alive,
-- 5 of 5 gone; VMK801 also gone in 42609557767). All five absent from vmksa's own 206-ad index since
-- 11-06/07. Registered in ops_adjudicated_retraction first so auto_recover_false_inactive() keeps them hidden.
set local lock_timeout = '5s';

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select 'vmksa_residential_listings', t.id,
       'lifecycle 2026-11-09: vmksa ad read gone on its own page by two readers (crawl prune oracle + lifecycle-spot-check 42610690403, controls 5/5)',
       jsonb_build_object('ad_number', t.ad_number, 'listing_url', t.listing_url,
                          'strikes_before', t.missing_count, 'last_seen_at', t.last_seen_at,
                          'spot_check', 42610690403,
                          'migration', 'vmksa_hide_5_read_gone_by_two_readers',
                          'watched_by', 'mon_detect_adjudicated_reactivation')
from public.vmksa_residential_listings t
where t.active
  and t.id in (14110555, 19413994, 13604857, 13604845, 13604844)
  and t.last_seen_at < '2026-11-08'
  and not exists (select 1 from public.ops_adjudicated_retraction r
                   where r.source_table = 'vmksa_residential_listings' and r.listing_id = t.id);

update public.vmksa_residential_listings t
   set active = false, deactivated_at = now()
 where t.active
   and exists (select 1 from public.ops_adjudicated_retraction r
                where r.source_table = 'vmksa_residential_listings' and r.listing_id = t.id
                  and r.reason like 'lifecycle 2026-11-09: vmksa ad read gone on its own page%');
