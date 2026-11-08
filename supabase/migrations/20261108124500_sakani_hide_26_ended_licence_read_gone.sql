-- ♻️ 2026-11-08: hide 26 shown sakani units whose REGA ad licence has ended (additional_info.ad_license_end_date, the
-- source's own published end, 2026-11-05..07) AND whose own page read gone to lifecycle-spot-check 42478842663
-- (site-oracle, known-live controls 5/5 alive, 26 of 26 gone) — two independent signals from the source. Includes
-- 22223720 (SKS23002, the 11-07 dead-visible gone_id). The other 143 ended-licence units stay with the
-- fleet_liveness:sakani APPLY rechecks (14:17 / 20:56 UTC). Registered in ops_adjudicated_retraction first.
set local lock_timeout = '5s';

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select 'sakani_residential_listings', t.id,
       'lifecycle 2026-11-08: sakani unit with an ended REGA ad licence read gone on its own page (lifecycle-spot-check 42478842663, controls 5/5)',
       jsonb_build_object('ad_number', t.ad_number, 'listing_url', t.listing_url,
                          'ad_license_end_date', t.additional_info->>'ad_license_end_date',
                          'spot_check', 42478842663,
                          'migration', '20261108124500_sakani_hide_26_ended_licence_read_gone',
                          'watched_by', 'mon_detect_adjudicated_reactivation')
from public.sakani_residential_listings t
where t.active
  and t.id in (22223720, 21086873, 21086874, 22222841, 22222858, 22222859, 22222860, 22222861, 22222862, 22222863,
               22222865, 22222866, 22222869, 22222870, 22222871, 22222877, 22222882, 22222891, 22222892, 22222893,
               22222894, 22222895, 22222896, 22222901, 22222902, 22222903)
  and left(t.additional_info->>'ad_license_end_date', 10) < '2026-11-08'
  and not exists (select 1 from public.ops_adjudicated_retraction r
                   where r.source_table = 'sakani_residential_listings' and r.listing_id = t.id);

update public.sakani_residential_listings t
   set active = false, deactivated_at = now()
 where t.active
   and exists (select 1 from public.ops_adjudicated_retraction r
                where r.source_table = 'sakani_residential_listings' and r.listing_id = t.id
                  and r.reason like 'lifecycle 2026-11-08: sakani unit with an ended REGA ad licence%');
