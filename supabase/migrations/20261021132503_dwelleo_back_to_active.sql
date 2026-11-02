-- Dwelleo back to active (owner 2026-10-21: «want it live most importantly»). It went dormant on 2026-10-07
-- because its API served 0 listings and its pages answered 404; the dormant note says «Back to active the first
-- night the API serves listings again». Re-measured 2026-10-21: the API serves 6,331 listings on 317 pages, the
-- walk at 11:54 UTC wrote 3,543 rows with live public pages, 100 of 100 random ones open with HTTP 200, and 26
-- of 27 sampled match the source's own record on price, area, rooms, bathrooms, pin, city and district (the
-- 27th's pin is Dwelleo's registered default point, stripped on purpose). The pre-outage rows were retired and
-- adjudicated in 20261021132404, so nothing stale comes back with it.
update public.platform_registry
   set status = 'active',
       notes = notes || E'\n[2026-10-21 13:30 UTC] dormant -> active: owner «want it live»; API 6,331 listings, 3,543 rows with live pages (100/100 HTTP 200), 26/27 match source; stale pre-outage rows retired by 20261021132404.',
       updated_at = now()
 where platform = 'dwelleo' and status = 'dormant';

do $proof$
begin
  if (select status from public.platform_registry where platform = 'dwelleo') <> 'active' then
    raise exception 'PROOF: dwelleo is not active';
  end if;
end $proof$;
