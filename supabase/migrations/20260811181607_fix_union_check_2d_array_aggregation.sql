-- Fix: array_agg over a text[] column builds a 2-D array whose single-subscript read degenerates to
-- text (hence "array_cat(text, text) does not exist"). Take district #1 and #2 as two lateral rows
-- (offset 0/1) and concatenate their match_values directly — no aggregation of arrays at all.
-- Checks 1 and 2 are byte-identical to the previous definition; only section 3's row-sourcing changed.
create or replace function public.mon_trending_district_barrier()
returns table(check_name text, detail text, n bigint)
language plpgsql
stable
as $function$
declare
  r record;
  v_dead   bigint := 0;
  v_drift  bigint := 0;
  v_worst  text   := '';
begin
  return query
  with live as (
    select s.city_id, public.norm_district_tok(s.district_ar) tok, count(*) n
    from public.search_listings_ar s
    where s.production_ready and s.district_ar is not null and s.city_id is not null
    group by 1,2
  )
  select 'unreachable_listings_no_catalog_district'::text,
         'listings whose district is absent from loc_canonical_district — unfindable by district'::text,
         coalesce(sum(l.n) filter (where c.city_id is null), 0)::bigint
  from live l
  left join public.loc_canonical_district c
    on c.city_id = l.city_id and c.district_norm = l.tok
  having coalesce(sum(l.n) filter (where c.city_id is null), 0) > 0;

  for r in
    with deals as (select unnest(array['بيع','إيجار']) d),
    cities as (
      select dl.d, t.city_id, t.city_ar
      from deals dl, lateral (select * from public.top_cities_by_deal_ar(dl.d) limit 5) t
    )
    select c.d, c.city_id, c.city_ar, o.district_ar, o.listing_count promised, o.match_values
    from cities c, lateral (
      select * from public.district_options_ar(c.city_id, c.d)
      order by listing_count desc nulls last limit 3
    ) o
    where o.listing_count > 0
  loop
    declare v_delivered bigint;
    begin
      select coalesce(x.total_count, 0) into v_delivered
      from public.location_search_candidates_ar(
             p_deal := r.d, p_cities := array[r.city_ar],
             p_districts := r.match_values, p_limit := 1) x
      limit 1;
      v_delivered := coalesce(v_delivered, 0);

      if v_delivered = 0 then
        v_dead := v_dead + 1;
        v_worst := left(v_worst || r.city_ar || '/' || r.district_ar || ' DEAD; ', 400);
      elsif v_delivered <> r.promised then
        v_drift := v_drift + 1;
        v_worst := left(v_worst || r.city_ar || '/' || r.district_ar
                        || ' ' || r.promised || '→' || v_delivered || '; ', 400);
      end if;
    end;
  end loop;

  if v_dead > 0 then
    return query select 'trending_chip_dead_end'::text,
                        ('chip promises listings, search returns none: ' || v_worst)::text, v_dead;
  end if;
  if v_drift > 0 then
    return query select 'trending_count_differs_from_search'::text,
                        ('promised <> delivered: ' || v_worst)::text, v_drift;
  end if;

  -- 3. MULTI-DISTRICT UNION (2026-08-10): [A] + [B] searched together = count(A) + count(B).
  --    Exact, not approximate: district_options_ar folds are disjoint, so no listing can belong to
  --    two option rows. under-count = the OR lost recall; over-count = the folding broke.
  for r in
    with deals as (select unnest(array['بيع','إيجار']) d),
    top_city as (
      select dl.d, t.city_id, t.city_ar
      from deals dl, lateral (select * from public.top_cities_by_deal_ar(dl.d) limit 1) t
    )
    select tc.d, tc.city_ar,
           a.district_ar name_a, b.district_ar name_b,
           a.listing_count + b.listing_count expected_sum,
           a.match_values || b.match_values union_mv
    from top_city tc
    cross join lateral (select * from public.district_options_ar(tc.city_id, tc.d)
                        where listing_count > 0 order by listing_count desc nulls last limit 1) a
    cross join lateral (select * from public.district_options_ar(tc.city_id, tc.d)
                        where listing_count > 0 order by listing_count desc nulls last limit 1 offset 1) b
  loop
    declare v_union bigint;
    begin
      select coalesce(x.total_count, 0) into v_union
      from public.location_search_candidates_ar(
             p_deal := r.d, p_cities := array[r.city_ar],
             p_districts := r.union_mv, p_limit := 1) x
      limit 1;
      v_union := coalesce(v_union, 0);

      if v_union <> r.expected_sum then
        return query select 'multi_district_union_mismatch'::text,
          (r.city_ar || '/' || r.d || ': [' || r.name_a || ' + ' || r.name_b
           || '] union=' || v_union || ' expected sum=' || r.expected_sum
           || ' — OR semantics drifted (under = lost recall, over = fold broke)')::text,
          abs(v_union - r.expected_sum)::bigint;
      end if;
    end;
  end loop;
end $function$;