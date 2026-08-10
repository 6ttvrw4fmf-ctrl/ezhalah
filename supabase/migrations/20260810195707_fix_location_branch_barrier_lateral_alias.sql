-- Fix: the lateral referenced an alias `t` that was never bound (the set-returning function's own
-- columns are exposed directly). Behaviour of the barrier is unchanged; it simply now runs.
create or replace function public.mon_location_predicate_branch_barrier()
returns table(check_name text, city_ar text, deal_ar text, rpc_total bigint, truth bigint, gap bigint)
language plpgsql
stable
as $function$
declare r record; v_rpc bigint; v_truth bigint;
begin
  for r in
    select c.city_ar cty, d.deal
    from (select unnest(array['بيع','إيجار']) deal) d,
         lateral (select city_ar from public.top_cities_by_deal_ar(d.deal) limit 6) c
  loop
    select coalesce(x.total_count, 0) into v_rpc
    from public.location_search_candidates_ar(
           p_deal := r.deal, p_cities := array[r.cty], p_limit := 1) x
    limit 1;
    v_rpc := coalesce(v_rpc, 0);

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
      and s.deal_ar = r.deal
      and (public.normalize_ar(s.city_ar) in (select tok from ct)
           or s.city_id in (select city_id from ids)
           or s.match_city_ids && (select array_agg(city_id) from ids));

    if v_rpc <> v_truth then
      return query select 'city_branch_count_gap'::text, r.cty, r.deal, v_rpc, v_truth, (v_truth - v_rpc);
    end if;
  end loop;
end $function$;