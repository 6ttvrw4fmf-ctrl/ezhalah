-- Heavy maintenance functions are NOT public API (2026-09-27, owner-approved).
--
-- These three had PUBLIC + anon + authenticated EXECUTE, so anyone holding the publishable key could call
-- /rest/v1/rpc/<fn>. Each call makes the backend PLAN listing_native_location_v2 (~270 MB of planner
-- memory, measured with EXPLAIN (MEMORY)); audit_location_counts adds mon_search_index_city_drift
-- (~310 MB), and before migration 20260926235614 it needed ~970 MB in one statement. Two of them are
-- SECURITY DEFINER, so they would run in full. A loop of such calls can exhaust the 8 GB instance, which
-- restarted four times on 2026-09-26 from cron load alone.
--
-- Nothing legitimate is lost: 0 API calls to any of the three in edge_logs 2026-09-20..27, no rpc() call
-- site in the repo, and no function body calls them (every match is a comment or message). Their only
-- callers are pg_cron jobid 28 and jobid 50, which run as postgres, the owner. service_role keeps its grant.
--
-- CREATE OR REPLACE keeps this ACL; a DROP + CREATE would get the schema's default grants back.

revoke execute on function
  public.audit_location_counts(),
  public.refresh_mon_audit_counts(),
  public.sync_search_listings_ar()
from public, anon, authenticated;

do $$
declare f text; r text;
begin
  foreach f in array array['public.audit_location_counts()',
                           'public.refresh_mon_audit_counts()',
                           'public.sync_search_listings_ar()'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f::regprocedure, 'execute') then
        raise exception '% can still execute %', r, f;
      end if;
    end loop;
    if not has_function_privilege('service_role', f::regprocedure, 'execute') then
      raise exception 'service_role lost execute on %', f;
    end if;
  end loop;
end $$;
