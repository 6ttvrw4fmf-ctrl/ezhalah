-- Audit count helper (2026-07-27). The nightly audit's not-ready + stale-index checks count over
-- listing_native_location_v2 (a view over matviews with LATERAL joins) and mon_search_index_city_drift
-- (a big table×view join). Via PostgREST those `count=exact` calls can hit the short per-request
-- statement_timeout (seen: 57014 "canceling statement due to statement timeout", esp. during a
-- concurrent matview refresh) — a flaky RED nightly. The queries themselves are sub-second over a
-- direct connection, so we wrap them in a SECURITY DEFINER function that raises its OWN statement
-- timeout for the duration, and return all three counts in one call.
create or replace function public.audit_location_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb;
begin
  set local statement_timeout = '180s';
  select jsonb_build_object(
    'not_ready_total',       (select count(*) from listing_native_location_v2 where production_ready = false),
    'not_ready_unexplained', (select count(*) from listing_native_location_v2
                                where production_ready = false
                                  and city_id is not null and city_ar is not null and btrim(city_ar) <> ''),
    'search_index_drift',    (select count(*) from mon_search_index_city_drift)
  ) into r;
  return r;
end
$$;
