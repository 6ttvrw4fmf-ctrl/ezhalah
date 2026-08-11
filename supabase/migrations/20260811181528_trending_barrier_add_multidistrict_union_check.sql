-- DISTRICT MULTI-SELECT union check (owner feature, 2026-08-10).
--
-- The Filter now lets a user pick SEVERAL districts; the app sends the union of their match_values
-- as p_districts, and the RPC treats the array as OR, ANDed with everything else. This check pins
-- that behavioural contract: for the top city of each deal, searching [A] and [B] together must
-- return EXACTLY count(A) + count(B). That equality is exact — not approximate — because
-- district_options_ar folds hamza twins into disjoint groups (one row per fold), so two different
-- option rows can never share a listing. A drift in either direction is a real defect:
--   union < sum  → the OR is dropping rows (a district's spellings lost recall), or
--   union > sum  → a listing is matching two chips at once (the folding broke).
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
  -- 1. UNREACHABLE INVENTORY (unchanged): a district present in listings but absent from
  --    loc_canonical_district is dropped from the picker entirely — silent loss.
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

  -- 2. PROMISED = DELIVERED (unchanged): top 3 districts of the top 5 cities, both deals, called
  --    exactly as the app calls it — p_districts := match_values.
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

  -- 3. MULTI-DISTRICT UNION (new, 2026-08-10): [A] + [B] searched together = count(A) + count(B).
  for r in
    with deals as (select unnest(array['بيع','إيجار']) d),
    top_city as (
      select dl.d, t.city_id, t.city_ar
      from deals dl, lateral (select * from public.top_cities_by_deal_ar(dl.d) limit 1) t
    ),
    top2 as (
      select tc.d, tc.city_ar,
             (array_agg(o.district_ar    order by o.listing_count desc))[1:2] names,
             (array_agg(o.listing_count  order by o.listing_count desc))[1:2] counts,
             array_cat((array_agg(o.match_values order by o.listing_count desc))[1],
                       (array_agg(o.match_values order by o.listing_count desc))[2]) union_mv
      from top_city tc, lateral (
        select * from public.district_options_ar(tc.city_id, tc.d)
        where listing_count > 0
        order by listing_count desc nulls last limit 2
      ) o
      group by tc.d, tc.city_ar
      having count(*) = 2
    )
    select * from top2
  loop
    declare v_union bigint; v_sum bigint;
    begin
      v_sum := r.counts[1] + r.counts[2];
      select coalesce(x.total_count, 0) into v_union
      from public.location_search_candidates_ar(
             p_deal := r.d, p_cities := array[r.city_ar],
             p_districts := r.union_mv, p_limit := 1) x
      limit 1;
      v_union := coalesce(v_union, 0);

      if v_union <> v_sum then
        return query select 'multi_district_union_mismatch'::text,
          (r.city_ar || '/' || r.d || ': [' || array_to_string(r.names, ' + ')
           || '] union=' || v_union || ' expected sum=' || v_sum
           || ' — OR semantics drifted (under = lost recall, over = fold broke)')::text,
          abs(v_union - v_sum)::bigint;
      end if;
    end;
  end loop;
end $function$;

comment on function public.mon_trending_district_barrier() is
  'Trending Districts barrier: every chip''s count must equal what clicking it returns (called with '
  'match_values, exactly as src/app/index.tsx does — the display name loses the hamza twin), no '
  'district with inventory may be missing from the canonical catalog, and (2026-08-10, multi-select) '
  'searching two districts together must return EXACTLY the sum of their individual counts — folds '
  'are disjoint, so any deviation means the OR dropped rows or the folding broke. Runs daily via '
  'mon_detect_trending_district_dead_end (gated).';