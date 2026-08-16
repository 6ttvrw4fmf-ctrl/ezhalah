-- Extend mon_detect_trending_cohort_drift with the three owner barriers not yet probed:
--   #9  Monthly separation — trending(pm=true) must equal search(شهري) (monthly AND NOT rnpl,
--       mirroring PR #367's closed window), so the frozen Monthly surface can never drift silently;
--   #13 multi-district OR — selecting the top-2 districts together must return exactly n1+n2
--       (districts are disjoint after hamza-folding, so union == sum; a duplicate canonical
--       location or broken OR semantics breaks this equality — also covers #14);
--   #6  city ↔ region integrity — the trending row's region_id must be the catalog's region for
--       that city_id (a bad join here would misfile a city under the wrong region).
-- #19 (the barrier itself must run) is covered by existing machinery: this detector owns pg_cron
-- 'mon-trending-cohort-drift', and mon_detect_orphaned_detectors fires if that job is ever removed.
--
-- MUTATION-TESTED 2026-08-15 (in a rolled-back transaction): reintroducing the exact day-one bug
-- (the stale annual clause that missed RNPL rows) made this detector return 1; the clean run after
-- rollback returned 0 with 9,907 restored. The barrier is proven to fire, not assumed.

create or replace function public.mon_detect_trending_cohort_drift()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  n int := 0; bad jsonb := '[]'::jsonb;
  r record; s_cnt int; d record; ds_cnt int;
  d2 record; pair_cnt int; cat_region int;
begin
  for r in
    with probe(label, deal, pm, period, types) as (values
      ('apt-rent-annual', 'إيجار', false, 'سنوي', array['شقة']),
      ('apt-rent-monthly','إيجار', true,  'شهري', array['شقة']),   -- barrier #9
      ('apt-buy',         'بيع',   null::boolean, null::text, array['شقة']),
      ('floor-rent-annual','إيجار', false, 'سنوي', array['دور']),
      ('building-buy',    'بيع',   null, null, array['عمارة']),
      ('untyped-rent-annual','إيجار', false, 'سنوي', null::text[])
    )
    select p.label, p.deal, p.pm, p.period, p.types,
           tc.city_id as t_city_id, tc.city_ar, tc.region_id as t_region_id,
           tc.listing_count, tc.total_in_cohort,
           sum(tc.listing_count) over (partition by p.label) as sum_cities
    from probe p
    cross join lateral (
      select * from top_cities_by_deal_ar(p.deal, p.pm, 'Residential', p.types)
      order by listing_count desc limit 1
    ) tc
  loop
    if r.listing_count < 0 or r.listing_count > r.total_in_cohort or r.sum_cities > r.total_in_cohort then
      bad := bad || jsonb_build_object('probe', r.label, 'kind', 'pct_invariant',
        'count', r.listing_count, 'total', r.total_in_cohort, 'sum_cities', r.sum_cities);
    end if;
    select c.region_id into cat_region from loc_catalog_city c where c.city_id = r.t_city_id;
    if cat_region is distinct from r.t_region_id then
      bad := bad || jsonb_build_object('probe', r.label, 'kind', 'city_region_mismatch',
        'city', r.city_ar, 'trending_region', r.t_region_id, 'catalog_region', cat_region);
    end if;
    select max(total_count) into s_cnt from location_search_candidates_ar(
      p_deal := r.deal, p_rent_period := r.period, p_types := r.types,
      p_category := 'Residential', p_cities := array[r.city_ar], p_limit := 1);
    if coalesce(s_cnt, 0) <> r.listing_count then
      bad := bad || jsonb_build_object('probe', r.label, 'kind', 'city_drift',
        'city', r.city_ar, 'trending', r.listing_count, 'search', s_cnt);
    end if;
    select dd.* into d from district_options_ar(r.t_city_id, r.deal, 'Residential', r.pm, r.types) dd
      where dd.listing_count > 0 order by dd.listing_count desc limit 1;
    if found then
      select max(total_count) into ds_cnt from location_search_candidates_ar(
        p_deal := r.deal, p_rent_period := r.period, p_types := r.types,
        p_category := 'Residential', p_cities := array[r.city_ar],
        p_districts := d.match_values, p_limit := 1);
      if coalesce(ds_cnt, 0) <> d.listing_count
         or d.listing_count > d.total_in_city or d.listing_count < 0 then
        bad := bad || jsonb_build_object('probe', r.label, 'kind', 'district_drift',
          'district', d.district_ar, 'trending', d.listing_count, 'search', ds_cnt,
          'total_in_city', d.total_in_city);
      end if;
      select dd.* into d2 from district_options_ar(r.t_city_id, r.deal, 'Residential', r.pm, r.types) dd
        where dd.listing_count > 0 and dd.district_ar <> d.district_ar
        order by dd.listing_count desc limit 1;
      if found then
        select max(total_count) into pair_cnt from location_search_candidates_ar(
          p_deal := r.deal, p_rent_period := r.period, p_types := r.types,
          p_category := 'Residential', p_cities := array[r.city_ar],
          p_districts := d.match_values || d2.match_values, p_limit := 1);
        if coalesce(pair_cnt, 0) <> d.listing_count + d2.listing_count then
          bad := bad || jsonb_build_object('probe', r.label, 'kind', 'multi_district_or_drift',
            'districts', array[d.district_ar, d2.district_ar],
            'expected_sum', d.listing_count + d2.listing_count, 'union_returned', pair_cnt);
        end if;
      end if;
    end if;
  end loop;

  if jsonb_array_length(bad) > 0 then
    n := n + public.mon_raise('P1', 'trending_cohort_drift', 'search',
      'trending_cohort_drift',
      jsonb_build_object('failures', bad,
        'why', 'Trending city/district counts, percentages, region mapping or multi-district OR '
            || 'no longer match what the search RPC returns for the same cohort. The number on the '
            || 'chip is a promise; fix the predicate drift, never the display.'));
  else
    update public.alert_event set resolved_at = now()
     where kind = 'trending_cohort_drift' and dedup_key = 'trending_cohort_drift'
       and resolved_at is null;
  end if;
  return n;
end $$;

select mon_detect_trending_cohort_drift() as fired_now;
