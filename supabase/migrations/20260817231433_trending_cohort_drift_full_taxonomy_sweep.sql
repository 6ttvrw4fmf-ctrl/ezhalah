-- FULL TAXONOMY SWEEP extension (owner P1, 2026-08-18): the fixed 6-probe set below only ever
-- covered 3 Residential types (شقة/دور/عمارة) and NEVER a single Commercial cohort — Residential/
-- Commercial isolation drift on this contract was entirely unmonitored. Added `all_probes`, a UNION
-- of the original named probes with a DYNAMIC sweep over every live (type_ar, macro, period) with
-- real inventory (known_type_ar × {شهري,سنوي}, existence-gated against search_listings_ar) — this is
-- exactly the manual sweep proven clean 2026-08-18 (18/18 city, 18/18 district), now made permanent
-- and self-updating: a new type, or a type's first listing in either period, is covered automatically
-- with no hand-maintained VALUES row. Every hardcoded 'Residential' category literal is replaced with
-- the probe's own macro (r.macro) so Commercial cohorts are checked with the SAME rigor for the first
-- time. No other check logic changed (percentage/region/district/multi-district-OR all verbatim).
CREATE OR REPLACE FUNCTION public.mon_detect_trending_cohort_drift()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0; bad jsonb := '[]'::jsonb;
  r record; s_cnt int; d record; ds_cnt int;
  d2 record; pair_cnt int; cat_region int;
begin
  for r in
    with probe(label, deal, pm, period, types, macro) as (values
      ('apt-rent-annual', 'إيجار', false, 'سنوي', array['شقة'], 'Residential'),
      ('apt-rent-monthly','إيجار', true,  'شهري', array['شقة'], 'Residential'),   -- barrier #9
      ('apt-buy',         'بيع',   null::boolean, null::text, array['شقة'], 'Residential'),
      ('floor-rent-annual','إيجار', false, 'سنوي', array['دور'], 'Residential'),
      ('building-buy',    'بيع',   null, null, array['عمارة'], 'Residential'),
      ('untyped-rent-annual','إيجار', false, 'سنوي', null::text[], 'Residential')
    ),
    periods(pm, period_ar) as (values (true, 'شهري'), (false, 'سنوي')),
    taxonomy_probe as (
      select distinct 'taxonomy:' || k.type_ar || ':' || pr.period_ar as label,
             'إيجار'::text as deal, pr.pm, pr.period_ar as period,
             array[k.type_ar] as types, k.macro
      from known_type_ar k
      cross join periods pr
      where k.macro in ('Residential', 'Commercial')
        and exists (
          select 1 from search_listings_ar s
          where s.type_ar = k.type_ar and s.deal_ar = 'إيجار' and s.production_ready
            and (
              (pr.pm and s.payment_monthly = true and not coalesce(s.rent_now_pay_later, false))
              or (not pr.pm and (s.rent_period_ar = 'سنوي'
                   or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))
            )
        )
    ),
    all_probes as (
      select label, deal, pm, period, types, macro from probe
      union all
      select label, deal, pm, period, types, macro from taxonomy_probe
    )
    select p.label, p.deal, p.pm, p.period, p.types, p.macro,
           tc.city_id as t_city_id, tc.city_ar, tc.region_id as t_region_id,
           tc.listing_count, tc.total_in_cohort,
           sum(tc.listing_count) over (partition by p.label) as sum_cities
    from all_probes p
    cross join lateral (
      select * from top_cities_by_deal_ar(p.deal, p.pm, p.macro, p.types)
      order by listing_count desc limit 1
    ) tc
  loop
    if r.listing_count < 0 or r.listing_count > r.total_in_cohort or r.sum_cities > r.total_in_cohort then
      bad := bad || jsonb_build_object('probe', r.label, 'kind', 'pct_invariant',
        'count', r.listing_count, 'total', r.total_in_cohort, 'sum_cities', r.sum_cities);
    end if;
    -- #6 city belongs to its catalog region
    select c.region_id into cat_region from loc_catalog_city c where c.city_id = r.t_city_id;
    if cat_region is distinct from r.t_region_id then
      bad := bad || jsonb_build_object('probe', r.label, 'kind', 'city_region_mismatch',
        'city', r.city_ar, 'trending_region', r.t_region_id, 'catalog_region', cat_region);
    end if;
    -- #18 equality with the result RPC
    select max(total_count) into s_cnt from location_search_candidates_ar(
      p_deal := r.deal, p_rent_period := r.period, p_types := r.types,
      p_category := r.macro, p_cities := array[r.city_ar], p_limit := 1);
    if coalesce(s_cnt, 0) <> r.listing_count then
      bad := bad || jsonb_build_object('probe', r.label, 'kind', 'city_drift',
        'city', r.city_ar, 'trending', r.listing_count, 'search', s_cnt);
    end if;
    -- top district: equality + denominator
    select dd.* into d from district_options_ar(r.t_city_id, r.deal, r.macro, r.pm, r.types) dd
      where dd.listing_count > 0 order by dd.listing_count desc limit 1;
    if found then
      select max(total_count) into ds_cnt from location_search_candidates_ar(
        p_deal := r.deal, p_rent_period := r.period, p_types := r.types,
        p_category := r.macro, p_cities := array[r.city_ar],
        p_districts := d.match_values, p_limit := 1);
      if coalesce(ds_cnt, 0) <> d.listing_count
         or d.listing_count > d.total_in_city or d.listing_count < 0 then
        bad := bad || jsonb_build_object('probe', r.label, 'kind', 'district_drift',
          'district', d.district_ar, 'trending', d.listing_count, 'search', ds_cnt,
          'total_in_city', d.total_in_city);
      end if;
      -- #13/#14 multi-district OR: top-2 together must return exactly n1+n2
      select dd.* into d2 from district_options_ar(r.t_city_id, r.deal, r.macro, r.pm, r.types) dd
        where dd.listing_count > 0 and dd.district_ar <> d.district_ar
        order by dd.listing_count desc limit 1;
      if found then
        select max(total_count) into pair_cnt from location_search_candidates_ar(
          p_deal := r.deal, p_rent_period := r.period, p_types := r.types,
          p_category := r.macro, p_cities := array[r.city_ar],
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
end $function$;
