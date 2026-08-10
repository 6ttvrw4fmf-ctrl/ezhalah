-- LOCATION PREDICATE BRANCH BARRIER (Filter audit, 2026-08-10).
--
-- A city match is a THREE-branch OR and every branch carries listings the others miss:
--   1. normalize_ar(city_ar)  — the row's own Arabic city text
--   2. city_id                — the resolved catalog id (incl. alias ids)
--   3. match_city_ids &&      — rows that legitimately answer to several city ids
-- The tempting "optimization" is to keep only branch 2, because that alone is trivially indexable.
-- Doing so silently drops every row whose city_id never resolved and every multi-id row — a quiet
-- loss of inventory that no test of "does search still work" would catch, because search still works,
-- just over fewer listings.
--
-- 2026-08-10 the predicate was rewritten from `x IN (SELECT …)` to `x = ANY (ARRAY(SELECT …))` purely
-- so the planner can use the indexes that already existed (hashed SubPlans are not index conditions).
-- That produced a BitmapOr over idx_slar_city_norm + idx_slar_deal_city + idx_slar_match_city_ids:
-- Riyadh/Buy 590 ms → 255 ms, buffers 89,853 → 10,331; typical filtered search 117 ms → 65 ms; and
-- 12/12 query shapes returned byte-identical ordered digests. This barrier is what keeps the NEXT
-- such rewrite honest: it recomputes the three-branch truth independently and compares it to what the
-- RPC actually returns, so any branch that goes missing shows up as a count gap.
create or replace function public.mon_location_predicate_branch_barrier()
returns table(check_name text, city_ar text, deal_ar text, rpc_total bigint, truth bigint, gap bigint)
language plpgsql
stable
as $function$
declare r record; v_rpc bigint; v_truth bigint;
begin
  for r in
    select c.city_ar, d.deal
    from (select unnest(array['بيع','إيجار']) deal) d,
         lateral (select t.city_ar from public.top_cities_by_deal_ar(d.deal) limit 6) c
  loop
    select coalesce(x.total_count, 0) into v_rpc
    from public.location_search_candidates_ar(
           p_deal := r.deal, p_cities := array[r.city_ar], p_limit := 1) x
    limit 1;
    v_rpc := coalesce(v_rpc, 0);

    -- Independent reconstruction of the same three branches, deliberately written in the ORIGINAL
    -- IN (SELECT …) form: if the RPC's rewritten form ever stops meaning the same thing, these two
    -- numbers separate.
    with ct as (
      select public.normalize_ar(r.city_ar) tok
      union
      select public.normalize_ar(b.city_ar) from public.city_name_bridge b
      where public.norm_en_place(b.city_en) = public.norm_en_place(r.city_ar)
    ), ids as (
      select cc.city_id from public.loc_catalog_city cc join ct on cc.city_norm = ct.tok
      union
      select a.city_id from public.loc_catalog_city_alias a join ct on a.alias_norm = ct.tok
    )
    select count(*) into v_truth
    from public.search_listings_ar s
    where s.production_ready
      and s.deal_ar = r.deal
      and (public.normalize_ar(s.city_ar) in (select tok from ct)
           or s.city_id in (select city_id from ids)
           or s.match_city_ids && (select array_agg(city_id) from ids));

    if v_rpc <> v_truth then
      return query select 'city_branch_count_gap'::text, r.city_ar, r.deal, v_rpc, v_truth, (v_truth - v_rpc);
    end if;
  end loop;
end $function$;

comment on function public.mon_location_predicate_branch_barrier() is
  'Location predicate barrier (2026-08-10): the city match is a 3-branch OR (city_ar text / city_id / '
  'match_city_ids overlap) and each branch holds listings the others miss. Recomputes the truth '
  'independently in the ORIGINAL IN (SELECT ...) form and compares to the live RPC, so a future '
  '"optimization" that collapses the OR to city_id alone shows up as a count gap instead of a silent '
  'loss of inventory. Verified empty at creation, immediately after the ARRAY(SELECT ...) rewrite.';