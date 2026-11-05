-- ♻️ 2026-11-05: re-hide the 4,369 dwelleo ads auto_recover_false_inactive() resurrected at 05:20 UTC.
-- Owner order 2026-11-05 «follow the source» (dwelleo cut its catalogue 11,480 → 18). Each row here
-- carries TWO independent GONE readings of its own ad, both newer than its last ALIVE stamp:
--   1. dwelleo.follow_source 03:08-04:09 UTC (API 422/404 AND stored page plain 404), and
--   2. fleet_liveness:dwelleo 08:37-10:20 UTC APPLY run (controls passed, dead=4371, struck=4369).
-- They are registered in ops_adjudicated_retraction first, so no recovery run can undo the decision,
-- then hidden. mon_detect_adjudicated_reactivation (on the roster) raises if any of them is served again.
-- The 18 rows the source still serves (missing_count 0, fresh) are not touched.
set local lock_timeout = '5s';

insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
select c.tbl, c.id,
       'dwelleo follow-source (owner 2026-11-05): own ad read GONE twice — API+page at 03:08-04:09 UTC and fleet_liveness 08:37-10:20 UTC; resurrected by the 05:20 recovery run',
       jsonb_build_object('ad_number', c.ad_number, 'follow_source_probed_at', c.fs_at,
                          'fleet_run', 'fleet_liveness:dwelleo 2026-11-05 08:37', 'missing_count', c.missing_count,
                          'last_verified_alive_at', c.lva, 'migration', 'recovery_must_not_undo_an_own_page_gone_hide',
                          'watched_by', 'mon_detect_adjudicated_reactivation')
from (
  select x.tbl, x.id, x.ad_number, x.missing_count, x.lva,
         (select max(p.probed_at) from public.ops_stale_inactivation_probe p
           where p.source_table = x.tbl and p.ad_number = x.ad_number and p.verdict = 'GONE'
             and p.oracle = 'dwelleo.follow_source' and p.probed_at >= '2026-11-05 03:00+00') fs_at
  from (
    select 'dwelleo_residential_listings'::text tbl, id, ad_number, missing_count, last_verified_alive_at lva
      from public.dwelleo_residential_listings where active
    union all
    select 'dwelleo_commercial_listings', id, ad_number, missing_count, last_verified_alive_at
      from public.dwelleo_commercial_listings where active
  ) x
) c
where c.fs_at is not null
  and c.fs_at > coalesce(c.lva, '-infinity'::timestamptz)
  and coalesce(c.missing_count, 0) >= 1
  and not exists (select 1 from public.ops_adjudicated_retraction r
                   where r.source_table = c.tbl and r.listing_id = c.id);

update public.dwelleo_residential_listings t
   set active = false, deactivated_at = now()
 where t.active
   and exists (select 1 from public.ops_adjudicated_retraction r
                where r.source_table = 'dwelleo_residential_listings' and r.listing_id = t.id
                  and r.reason like 'dwelleo follow-source (owner 2026-11-05)%');

update public.dwelleo_commercial_listings t
   set active = false, deactivated_at = now()
 where t.active
   and exists (select 1 from public.ops_adjudicated_retraction r
                where r.source_table = 'dwelleo_commercial_listings' and r.listing_id = t.id
                  and r.reason like 'dwelleo follow-source (owner 2026-11-05)%');