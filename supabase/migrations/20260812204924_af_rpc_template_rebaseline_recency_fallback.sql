-- The 2026-08-12 12:25 recency-fallback migration (search_rpc_order_by_recency_fallback) needle-
-- edited location_search_candidates_ar's LIVE body directly (a well-guarded, assertion-counted
-- edit -- a legitimate feature), bypassing the af_rpc_templates mechanism entirely. That tripped
-- mon_af_predicate_parity's check B (live md5 != recorded build-state md5) because the shared-
-- eligibility-layer TEMPLATE for this function was now stale relative to the live body it's
-- supposed to be able to regenerate. Left as-is, the next legitimate rebuild_af_filter_rpcs() call
-- (e.g. to change eligibility semantics) would have silently REVERTED today's recency-fallback
-- feature back to the old last_updated-only ordering -- a real regression risk, not just an alarm.
--
-- Fix: re-derive the template from the CURRENT live definition (same method the templates were
-- originally built with, migration 20260811130146), then rebuild and assert the regenerated
-- function is byte-identical to what was already live -- i.e. this is a pure re-baseline, it
-- changes no behavior, it only makes the template capable of reproducing what's already running.
do $do$
declare
  live_before text;
  clause text;
  occ_count int;
  new_template text;
  live_after text;
  build_md5 text;
  new_md5 text;
  parity_result int;
begin
  select pg_get_functiondef(p.oid) into live_before
  from pg_proc p where p.proname = 'location_search_candidates_ar' and p.pronamespace = 'public'::regnamespace;

  clause := af_eligibility_clause();

  occ_count := (length(live_before) - length(replace(live_before, clause, ''))) / length(clause);
  if occ_count <> 1 then
    raise exception 'ABORT: eligibility clause occurs % times in live def, expected exactly 1', occ_count;
  end if;

  new_template := replace(live_before, clause, '__AF_ELIGIBILITY_WHERE__');

  update af_rpc_templates set template = new_template where fn_name = 'location_search_candidates_ar';

  perform * from rebuild_af_filter_rpcs();

  select pg_get_functiondef(p.oid) into live_after
  from pg_proc p where p.proname = 'location_search_candidates_ar' and p.pronamespace = 'public'::regnamespace;

  if live_after <> live_before then
    raise exception 'ABORT: rebuild changed the live function body (byte diff) -- not a pure re-baseline';
  end if;

  select def_md5 into build_md5 from af_rpc_build_state where fn_name = 'location_search_candidates_ar';
  new_md5 := md5(live_after);
  if build_md5 <> new_md5 then
    raise exception 'ABORT: post-rebuild build_state md5 % does not match live md5 %', build_md5, new_md5;
  end if;

  select public.mon_af_predicate_parity() into parity_result;
  if parity_result <> 0 then
    raise exception 'ABORT: mon_af_predicate_parity still non-zero (%) after re-baseline', parity_result;
  end if;

  raise notice 'SUCCESS: template re-baselined from live def, rebuild reproduced byte-identical function, build_state md5 now matches, parity=0';
end $do$;