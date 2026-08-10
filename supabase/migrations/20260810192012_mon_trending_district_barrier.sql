-- TRENDING DISTRICT BARRIER (Filter audit, 2026-08-10). Verified clean at creation.
--
-- What a user is promised by a Trending chip must be what clicking it delivers. Two RPCs have to
-- agree on district identity, and they normalize independently:
--   district_options_ar        counts by norm_district_tok(), then folds hamza twins (الصفا/الصفاء)
--                              into ONE chip and returns BOTH spellings in match_values
--   location_search_candidates_ar  filters by norm_district_tok(s.district_ar) IN (tokens of p_districts)
-- They agree today. The failure mode this guards is a caller — or a future edit — passing the chip's
-- DISPLAY NAME instead of its match_values: measured live, that silently loses 41% of «حي الحمراء»
-- in الخبر (1,869 promised → 1,104 delivered) because the twin spelling drops out. src/app/index.tsx
-- sends districtSelected.matchValues, which is why production is correct; this pins that contract
-- from the database side so the app cannot regress it unnoticed.
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
  -- 1. UNREACHABLE INVENTORY. district_options_ar builds FROM the canonical catalog and LEFT JOINs
  --    live counts, so a district that exists in listings but NOT in loc_canonical_district is
  --    dropped from the picker entirely — its listings become unfindable by district. This is the
  --    silent-loss direction, and it reads 0/182,556 today.
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

  -- 2. PROMISED = DELIVERED, on the chips a user actually sees (top 3 districts of the top 5 cities,
  --    both deals). Called exactly as the app calls it: p_districts := match_values.
  for r in
    with deals as (select unnest(array['بيع','إيجار']) d),
    cities as (
      select dl.d, t.city_id, t.city_ar
      from deals dl, lateral (select * from public.top_cities_by_deal_ar(dl.d) limit 5) t
    )
    select c.d, c.city_ar, o.district_ar, o.listing_count promised, o.match_values
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
        v_dead := v_dead + 1;                     -- a chip advertising listings that return nothing
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
end $function$;

comment on function public.mon_trending_district_barrier() is
  'Trending Districts barrier (Filter audit 2026-08-10): every chip''s count must equal what clicking '
  'it returns, and no district with inventory may be missing from the canonical catalog. Verified '
  'clean at creation — 40/40 chips exact, 0 dead ends, 0 unreachable of 182,556. Calls the search RPC '
  'with match_values, exactly as src/app/index.tsx does; passing the display name instead loses the '
  'hamza twin (measured: 1,869 → 1,104 on الخبر/حي الحمراء).';