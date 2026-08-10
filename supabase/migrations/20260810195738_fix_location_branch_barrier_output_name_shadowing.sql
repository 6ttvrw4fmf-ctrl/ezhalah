-- Fix: RETURNS TABLE column names (city_ar, deal_ar) shadowed the underlying table columns inside
-- the body, so `select city_ar` was ambiguous. Renamed the OUTPUT columns; the checks are unchanged.
drop function if exists public.mon_location_predicate_branch_barrier();

create function public.mon_location_predicate_branch_barrier()
returns table(check_name text, probe_city text, probe_deal text, rpc_total bigint, truth_total bigint, gap bigint)
language plpgsql
stable
as $function$
declare r record; v_rpc bigint; v_truth bigint;
begin
  for r in
    select c.city_ar cty, d.deal dl
    from (select unnest(array['بيع','إيجار']) deal) d,
         lateral (select * from public.top_cities_by_deal_ar(d.deal) limit 6) c
  loop
    select coalesce(x.total_count, 0) into v_rpc
    from public.location_search_candidates_ar(
           p_deal := r.dl, p_cities := array[r.cty], p_limit := 1) x
    limit 1;
    v_rpc := coalesce(v_rpc, 0);

    -- Independent reconstruction of the three branches, deliberately kept in the ORIGINAL
    -- IN (SELECT ...) form so it cannot drift with the RPC's own phrasing.
    with ct as (
      select public.normalize_ar(r.cty) tok
      union
      select public.normalize_ar(b.city_ar) from public.city_name_bridge b
      where public.norm_en_place(b.city_en) = public.norm_en_place(r.cty)
    ), ids as (
      select cc.city_id from public.loc_catalog_city cc join ct on cc.city_norm = ct.tok
      union
      select a.city_id from public.loc_catalog_city_alias a join ct on a.alias_norm = ct.tok
    )
    select count(*) into v_truth
    from public.search_listings_ar s
    where s.production_ready
      and s.deal_ar = r.dl
      and (public.normalize_ar(s.city_ar) in (select tok from ct)
           or s.city_id in (select city_id from ids)
           or s.match_city_ids && (select array_agg(city_id) from ids));

    if v_rpc <> v_truth then
      return query select 'city_branch_count_gap'::text, r.cty, r.dl, v_rpc, v_truth, (v_truth - v_rpc);
    end if;
  end loop;
end $function$;

comment on function public.mon_location_predicate_branch_barrier() is
  'Location predicate barrier (2026-08-10): the city match is a 3-branch OR (city_ar text / city_id / '
  'match_city_ids overlap); each branch holds listings the others miss. Recomputes the truth '
  'independently and compares to the live RPC, so a future "optimization" collapsing the OR to '
  'city_id alone surfaces as a count gap instead of silent inventory loss.';