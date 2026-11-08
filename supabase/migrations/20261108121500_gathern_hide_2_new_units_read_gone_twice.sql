-- ♻️ 2026-11-08: hide 2 gathern units ingested at 04:26-04:30 UTC today and served at once, whose own page has never
-- answered live: the hourly sweep read HTTP 404 at 04:43, 07:03 and 08:08 UTC (gathern_liveness_detail, strike), and
-- lifecycle-spot-check 42476468102 (site-reader, known-live controls 5/5) read both gone at ~11:45 UTC. The other two
-- units of the same cohort (GTH283169, GTH283173) read LIVE to that spot check and are NOT touched (gathern flaps;
-- one reader is never proof). Registered in ops_adjudicated_retraction first; gathern-recheck-dead restores a unit
-- whose own page answers live again, and mon_detect_adjudicated_reactivation reports one served again.
set local lock_timeout = '5s';

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select 'gathern_residential_listings', t.id,
       'lifecycle 2026-11-08: new gathern unit served with a dead page — own page 404 x3 to the hourly sweep and gone to lifecycle-spot-check 42476468102 (controls 5/5), never read alive',
       jsonb_build_object('ad_number', t.ad_number, 'listing_url', t.listing_url,
                          'sweep_404_at', jsonb_build_array('2026-11-08 04:43', '2026-11-08 07:03', '2026-11-08 08:08'),
                          'spot_check', 42476468102,
                          'migration', '20261108121500_gathern_hide_2_new_units_read_gone_twice',
                          'watched_by', 'mon_detect_adjudicated_reactivation')
from public.gathern_residential_listings t
where t.active and t.id in (25436999, 25446442) and t.last_verified_alive_at is null
  and not exists (select 1 from public.ops_adjudicated_retraction r
                   where r.source_table = 'gathern_residential_listings' and r.listing_id = t.id);

update public.gathern_residential_listings t
   set active = false, deactivated_at = now()
 where t.active and t.id in (25436999, 25446442) and t.last_verified_alive_at is null
   and exists (select 1 from public.ops_adjudicated_retraction r
                where r.source_table = 'gathern_residential_listings' and r.listing_id = t.id
                  and r.reason like 'lifecycle 2026-11-08: new gathern unit served with a dead page%');
