-- map_fact_build_place_facts(): its check loop's record was named «r», the same alias as the removal log in the build
-- query, so PL/pgSQL refused the query («column reference "r.*" is ambiguous»). The record is renamed; nothing else changes.
create or replace function public.map_fact_build_place_facts()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_short text[]; v_ready boolean; v_cuts_ready boolean; v_rows int; v_t0 timestamptz := clock_timestamp();
  chk record; n1 bigint; n2 bigint; checked int := 0; failed int := 0; ex jsonb := '[]'::jsonb;
begin
  v_short := public.map_fact_short_pairs();
  v_ready := public.map_view_facts_gone_ready();
  v_cuts_ready := exists (select 1 from public.map_fact_source_start ss where ss.source = 'price_diary' and ss.started_at <= now() - interval '30 days');
  drop table if exists _pf_base;
  create temp table _pf_base on commit drop as
    select y.*, (y.price is null or y.area_m2 is null
                 or y.platform = min(y.platform) over (partition by y.deal, y.type_ar, y.price, y.area_m2, y.city_ar, y.district_ar)) as own
    from (select s.source_table, s.listing_id, s.platform, s.city_ar, s.district_ar, s.type_ar, s.area_m2, s.posted_at, x.deal,
                 case when s.deal_ar = 'بيع' then coalesce(s.price_total_effective, s.price_total) else s.price_annual end as price
          from public.map_listing_points_ar s
          cross join lateral (select case when s.deal_ar = 'بيع' then 'buy'
                                          when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
                                          when s.deal_ar = 'إيجار' then 'rent' end as deal) x
          where s.latitude is not null and s.longitude is not null and x.deal is not null and s.city_ar is not null
            and not exists (select 1 from public.ops_default_pin_register d
                            where d.source_table = s.source_table and d.lat = round(s.latitude::numeric, 5) and d.lng = round(s.longitude::numeric, 5))) y;
  create index on _pf_base (city_ar, district_ar, type_ar);

  truncate public.map_place_facts;
  with counts as (
    select case when grouping(b.district_ar) = 1 then 'city' else 'district' end as level, b.city_ar, coalesce(b.district_ar, '') as district_ar, b.deal,
           count(*) as n_ads,
           count(*) filter (where b.own and b.posted_at >= now() - interval '30 days' and b.posted_at <= now() + interval '1 day') as new30
    from _pf_base b
    group by grouping sets ((b.city_ar, b.deal), (b.city_ar, b.district_ar, b.deal))
  ), types as (
    select case when grouping(b.district_ar) = 1 then 'city' else 'district' end as level, b.city_ar, coalesce(b.district_ar, '') as district_ar, b.type_ar,
           count(*) as n, percentile_cont(0.5) within group (order by b.price / b.area_m2) as ppm
    from _pf_base b
    where b.deal = 'buy' and b.own and b.price > 0 and b.area_m2 > 0 and b.type_ar is not null
    group by grouping sets ((b.city_ar, b.type_ar), (b.city_ar, b.district_ar, b.type_ar))
  ), top as (
    select distinct on (t.level, t.city_ar, t.district_ar) t.level, t.city_ar, t.district_ar, t.type_ar, t.n, t.ppm
    from types t where t.n >= 10
    order by t.level, t.city_ar, t.district_ar, t.n desc, t.type_ar
  ), gone_rows as (
    select r.*, (r.price is null or r.area_m2 is null
                 or r.platform = min(r.platform) over (partition by r.deal, r.type_ar, r.price, r.area_m2, r.city_ar, r.district_ar)) as own
    from public.map_fact_removal r
    where v_ready and r.left_at >= now() - interval '30 days' and r.city_ar is not null
      and not exists (select 1 from public.ops_default_pin_register d
                      where d.source_table = r.source_table and d.lat = round(r.latitude::numeric, 5) and d.lng = round(r.longitude::numeric, 5))
  ), gone as (
    select case when grouping(g.district_ar) = 1 then 'city' else 'district' end as level, g.city_ar, coalesce(g.district_ar, '') as district_ar, g.deal, count(*) as n
    from gone_rows g where g.own
    group by grouping sets ((g.city_ar, g.deal), (g.city_ar, g.district_ar, g.deal))
  ), cuts as (
    select case when grouping(b.district_ar) = 1 then 'city' else 'district' end as level, b.city_ar, coalesce(b.district_ar, '') as district_ar, count(*) as n
    from _pf_base b
    where v_cuts_ready and b.own and b.deal = 'buy'
      and exists (select 1 from public.listing_price_history h
                  where h.source_table = b.source_table and h.listing_id = b.listing_id and h.event = 'price'
                    and h.at >= now() - interval '30 days' and h.price_total > 0 and h.old_price_total > 0
                    and h.price_total < h.old_price_total and h.price_total >= h.old_price_total * 0.5)
    group by grouping sets ((b.city_ar), (b.city_ar, b.district_ar))
  )
  insert into public.map_place_facts (level, city_ar, district_ar, deal, n_ads, new30, gone30, cuts30, top_type, top_ppm, top_ppm_n, built_at)
  select c.level, c.city_ar, c.district_ar, c.deal, c.n_ads, c.new30,
         case when v_ready then coalesce(g.n, 0) end,
         case when v_cuts_ready and c.deal = 'buy' then coalesce(k.n, 0) end,
         case when c.deal = 'buy' and t.ppm between 10 and 200000 then t.type_ar end,
         case when c.deal = 'buy' and t.ppm between 10 and 200000 then round(t.ppm)::bigint end,
         case when c.deal = 'buy' and t.ppm between 10 and 200000 then t.n end,
         now()
  from counts c
  left join top t on t.level = c.level and t.city_ar = c.city_ar and t.district_ar = c.district_ar
  left join gone g on g.level = c.level and g.city_ar = c.city_ar and g.district_ar = c.district_ar and g.deal = c.deal
  left join cuts k on k.level = c.level and k.city_ar = c.city_ar and k.district_ar = c.district_ar
  where not (c.level = 'district' and c.district_ar = '');
  get diagnostics v_rows = row_count;

  -- «أحياء قريبة» for districts: the 4 nearest districts' median for the district's own top type (same bounds as live)
  update public.map_place_facts p set nb_ppm = x.ppm, nb_names = x.names
  from (select p2.city_ar, p2.district_ar, nb.neighbors as names,
               round(percentile_cont(0.5) within group (order by b.price / b.area_m2))::bigint as ppm, count(*) as n
        from public.map_place_facts p2
        join public.map_district_neighbors nb on nb.city_ar = p2.city_ar and nb.district_ar = p2.district_ar and nb.built_at >= now() - interval '36 hours'
        join _pf_base b on b.city_ar = p2.city_ar and b.district_ar = any (nb.neighbors) and b.type_ar = p2.top_type
                       and b.deal = 'buy' and b.own and b.price > 0 and b.area_m2 > 0
        where p2.level = 'district' and p2.deal = 'buy' and p2.top_type is not null
        group by p2.city_ar, p2.district_ar, nb.neighbors) x
  where p.level = 'district' and p.deal = 'buy' and p.city_ar = x.city_ar and p.district_ar = x.district_ar
    and x.n >= 10 and x.ppm between 10 and 200000 and abs(p.top_ppm - x.ppm) <= 2 * x.ppm;

  -- the check: 5 random districts recounted another way, straight from the index (search_listings_ar)
  for chk in select * from public.map_place_facts where level = 'district' and deal = 'buy' order by random() limit 5 loop
    checked := checked + 1;
    select count(*), count(*) filter (where s.posted_at >= now() - interval '30 days' and s.posted_at <= now() + interval '1 day') into n1, n2
    from public.search_listings_ar s
    where s.city_ar = chk.city_ar and s.district_ar = chk.district_ar and s.deal_ar = 'بيع' and s.latitude is not null and s.longitude is not null
      and not exists (select 1 from public.map_stray_pin st where st.source_table = s.source_table and st.listing_id = s.listing_id)
      and not exists (select 1 from public.ops_default_pin_register d
                      where d.source_table = s.source_table and d.lat = round(s.latitude::numeric, 5) and d.lng = round(s.longitude::numeric, 5));
    -- the index moves every 10 minutes: a recount may differ by a few new ads, never by more than 3% or more than it holds
    if abs(n1 - chk.n_ads) > greatest(3, chk.n_ads * 0.03) or chk.new30 > chk.n_ads or chk.new30 > n2 + greatest(3, n2 * 0.03) then
      failed := failed + 1;
      ex := ex || jsonb_build_object('city', chk.city_ar, 'district', chk.district_ar, 'n_ads', chk.n_ads, 'recount', n1, 'new30', chk.new30, 'new30_raw_recount', n2);
    end if;
  end loop;
  insert into public.map_place_facts_build (rows, checked, failed, examples, ms)
  values (v_rows, checked, failed, ex, extract(milliseconds from clock_timestamp() - v_t0)::int);
  return jsonb_build_object('rows', v_rows, 'checked', checked, 'failed', failed, 'ms', extract(milliseconds from clock_timestamp() - v_t0)::int);
end
$function$;
revoke all on function public.map_fact_build_place_facts() from public, anon, authenticated;
