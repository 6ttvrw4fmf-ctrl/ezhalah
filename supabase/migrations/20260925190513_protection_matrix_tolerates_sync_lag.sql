-- ops_platform_protection_matrix(): location_protections tolerated no gap at all, so rows a crawl
-- inserted minutes ago (search_listings_ar syncs hourly) flipped a platform to UNPROTECTED — measured
-- 2026-09-25: alshawaf served 981 of 984 mid-crawl. Allow greatest(5, 0.2% of active) missing; a
-- structural gap (souq24 2/44 resolved, ramzalqasim 124/156, erapulse 43/62) still fails.
do $$
declare
  body text;
  anchor constant text := 'coalesce(s.n, 0) >= inv.active and coalesce(v1.n, 0) >= inv.active as loc_ok';
begin
  select pg_get_functiondef('public.ops_platform_protection_matrix'::regproc) into body;
  if position(anchor in body) = 0 then
    raise exception 'anchor not found in ops_platform_protection_matrix()';
  end if;
  execute replace(body, anchor,
    'inv.active - coalesce(s.n, 0) <= greatest(5, ceil(inv.active * 0.002)) '
    || 'and inv.active - coalesce(v1.n, 0) <= greatest(5, ceil(inv.active * 0.002)) as loc_ok');
end $$;
