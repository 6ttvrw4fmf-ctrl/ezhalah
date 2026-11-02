-- SECURITY PHASE 1.4 (owner-approved plan, 2026-10-20): one search call can no longer return the whole inventory.
--
-- location_search_candidates_ar accepted any p_limit / p_offset from the caller (it only clamped negatives), so the
-- publishable key could page through every listing id in a handful of calls. It now returns at most 5,000 rows per
-- call and nothing beyond offset 25,000:
--   * 5,000  = the largest page our own tools ask for (scrapers/common/af_score.py RPC_LIMIT); the app asks 1,500.
--   * 25,000 = the app's own ceiling (src/data/resultCount.ts DRAIN_ROW_BUDGET); «عرض المزيد» never pages deeper.
-- A deeper offset returns no rows (never a repeat of the last page). Counts (total_count) are unchanged.
--
-- The four AF RPCs are GENERATED (docs: never hand-edit them): the needle is applied to af_rpc_templates and the
-- function is re-rendered by rebuild_af_filter_rpcs(), which also records the new build fingerprint. Fails closed if
-- the template does not hold exactly the two expected LIMIT clauses.
--
-- Rollback: apply the reverse replace() on af_rpc_templates and perform rebuild_af_filter_rpcs().
do $mig$
declare
  old_lim constant text := 'limit greatest(p_limit, 0) offset greatest(p_offset, 0)';
  new_lim constant text := 'limit (case when greatest(p_offset, 0) > 25000 then 0 else least(greatest(p_limit, 0), 5000) end) offset greatest(p_offset, 0)';
  tpl text; occ int;
begin
  select template into tpl from public.af_rpc_templates where fn_name = 'location_search_candidates_ar';
  if tpl is null then raise exception 'location_search_candidates_ar: no template row'; end if;
  occ := (length(tpl) - length(replace(tpl, old_lim, ''))) / length(old_lim);
  if occ <> 2 then raise exception 'location_search_candidates_ar: LIMIT needle found % times in the template, expected 2', occ; end if;
  if exists (select 1 from public.af_rebuild_would_revert()) then
    raise exception 'location_search_candidates_ar: a rebuild would revert a live edit — refusing';
  end if;
  update public.af_rpc_templates set template = replace(tpl, old_lim, new_lim) where fn_name = 'location_search_candidates_ar';
  perform public.rebuild_af_filter_rpcs();
  if position(new_lim in pg_get_functiondef('public.location_search_candidates_ar'::regproc)) = 0 then
    raise exception 'location_search_candidates_ar: rebuilt function does not carry the cap';
  end if;
end
$mig$;
