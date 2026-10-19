-- audit_location_counts() PLANS listing_native_location_v2 ONCE (2026-09-26, owner-approved fix #2).
--
-- Production restarted four times on 2026-09-26 (02:22, 08:27, 11:44, 21:23 UTC); the host went silent
-- then rebooted, pgbouncer included - memory exhaustion, not a Postgres error. Measured on production
-- with EXPLAIN (MEMORY), nothing executed:
--
--   any query over listing_native_location_v2   ~270 MB just to PLAN (~700 table scans, every platform arm)
--   mon_search_index_city_drift                  ~310 MB to plan
--   the OLD body below, as ONE statement         ~970 MB to plan (v2 twice + the drift view)
--
-- jobid 50 ran that ~970 MB statement at :22, the same second jobid 28 (search sync, ~300 MB per
-- statement) starts. work_mem and join/from_collapse_limit do not change these numbers; the cost is
-- the planner expanding the platform arms, and it grows ~1 MB per platform per v2 plan.
--
-- Same three numbers, same jsonb keys, same timeout: one scan of the not-ready rows gives both v2
-- counts via FILTER (count where A and B == count(*) filter (where B) over rows where A), and the
-- drift count is its own statement, so the two big plans are never built together.
-- Peak planning ~970 MB -> ~310 MB.

create or replace function public.audit_location_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_total bigint; v_unexplained bigint; v_drift bigint;
begin
  set local statement_timeout = '180s';
  select count(*),
         count(*) filter (where city_id is not null and city_ar is not null and btrim(city_ar) <> '')
    into v_total, v_unexplained
    from listing_native_location_v2
   where production_ready = false;
  select count(*) into v_drift from mon_search_index_city_drift;
  return jsonb_build_object(
    'not_ready_total',       v_total,
    'not_ready_unexplained', v_unexplained,
    'search_index_drift',    v_drift);
end
$$;
