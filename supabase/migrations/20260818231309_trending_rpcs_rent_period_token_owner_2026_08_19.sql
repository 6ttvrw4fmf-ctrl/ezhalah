-- Trending (city/district) RPCs gain the same كلاهما (both-periods) token the results RPC already
-- has, instead of a boolean p_payment_monthly that can only say monthly/annual/no-filter. Today
-- selecting "both" periods sends payment_monthly=NULL to Trending, which is a BROADER set (also
-- admits rent rows whose source published no period at all) than what location_search_candidates_ar's
-- p_rent_period='كلاهما' token returns — a live Trending-vs-results scope mismatch, same shape as the
-- 2026-08-10 "MONTHLY/ANNUAL black hole" (PR #424). Fix: reuse the exact proven period predicate
-- fragment from af_eligibility_clause() / the other 3 RPCs (docs/ARCHITECTURE.md §17), verbatim.
--
-- Different arg list (p_payment_monthly boolean -> p_rent_period text) = a NEW overload per
-- Postgres, so we must drop the old signature explicitly (AGENTS.md "different arg list" rule).

drop function if exists public.top_cities_by_deal_ar(text, boolean, text, text[]);

CREATE OR REPLACE FUNCTION public.top_cities_by_deal_ar(p_deal text, p_rent_period text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_types text[] DEFAULT NULL::text[])
 RETURNS TABLE(city_id integer, city_ar text, region_id integer, region_ar text, listing_count integer, total_in_cohort integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH valid_category AS (
    SELECT CASE WHEN p_category IN ('Residential','Commercial') THEN p_category ELSE NULL END AS v
  ),
  cohort AS (
    SELECT s.city_id
    FROM search_listings_ar s CROSS JOIN valid_category
    WHERE s.production_ready = true AND s.deal_ar = p_deal
      AND (p_rent_period IS NULL
           OR s.deal_ar <> 'إيجار'
           OR (p_rent_period = 'شهري' AND s.payment_monthly = true AND NOT coalesce(s.rent_now_pay_later, false))
           OR (p_rent_period = 'سنوي' AND (s.rent_period_ar = 'سنوي' OR (s.rent_period_ar = 'شهري' AND coalesce(s.rent_now_pay_later, false))))
           OR (p_rent_period = 'كلاهما' AND (s.payment_monthly = true OR s.rent_period_ar = 'سنوي' OR (s.rent_period_ar = 'شهري' AND coalesce(s.rent_now_pay_later, false)))))
      AND (p_types IS NULL OR cardinality(p_types) = 0 OR s.type_ar = ANY(p_types))
      AND (valid_category.v IS NULL OR EXISTS (
          SELECT 1 FROM known_type_ar k WHERE k.type_ar = s.type_ar AND (k.macro = valid_category.v
                   OR (k.macro = 'both' AND (CASE valid_category.v
                         WHEN 'Residential' THEN s.source_table LIKE '%\_residential\_listings'
                         WHEN 'Commercial'  THEN s.source_table LIKE '%\_commercial\_listings'
                         ELSE true END)))
        ))
  ),
  total AS (SELECT count(*)::int AS t FROM cohort)
  SELECT co.city_id, c.city_ar, c.region_id, r.region_ar,
         count(*)::int AS listing_count, total.t AS total_in_cohort
  FROM cohort co
    JOIN loc_catalog_city c ON c.city_id = co.city_id
    LEFT JOIN loc_catalog_region r ON r.region_id = c.region_id
    CROSS JOIN total
  GROUP BY co.city_id, c.city_ar, c.region_id, r.region_ar, total.t
  ORDER BY listing_count DESC;
$function$;

grant execute on function public.top_cities_by_deal_ar(text, text, text, text[]) to anon, authenticated, service_role;

drop function if exists public.district_options_ar(integer, text, text, boolean, text[]);

CREATE OR REPLACE FUNCTION public.district_options_ar(p_city_id integer, p_deal text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_rent_period text DEFAULT NULL::text, p_types text[] DEFAULT NULL::text[])
 RETURNS TABLE(district_ar text, listing_count integer, match_values text[], total_in_city integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH valid_category AS (
    SELECT CASE WHEN p_category IN ('Residential','Commercial') THEN p_category ELSE NULL END AS v
  ),
  cohort AS (
    SELECT s.district_ar
    FROM public.search_listings_ar s CROSS JOIN valid_category
    WHERE s.city_id = p_city_id AND s.production_ready
      AND (p_deal IS NULL OR s.deal_ar = p_deal)
      AND (p_rent_period IS NULL
           OR s.deal_ar <> 'إيجار'
           OR (p_rent_period = 'شهري' AND s.payment_monthly = true AND NOT coalesce(s.rent_now_pay_later, false))
           OR (p_rent_period = 'سنوي' AND (s.rent_period_ar = 'سنوي' OR (s.rent_period_ar = 'شهري' AND coalesce(s.rent_now_pay_later, false))))
           OR (p_rent_period = 'كلاهما' AND (s.payment_monthly = true OR s.rent_period_ar = 'سنوي' OR (s.rent_period_ar = 'شهري' AND coalesce(s.rent_now_pay_later, false)))))
      AND (p_types IS NULL OR cardinality(p_types) = 0 OR s.type_ar = ANY(p_types))
      AND (valid_category.v IS NULL OR EXISTS (
        SELECT 1 FROM known_type_ar k WHERE k.type_ar = s.type_ar AND (k.macro = valid_category.v
                 OR (k.macro = 'both' AND (CASE valid_category.v
                       WHEN 'Residential' THEN s.source_table LIKE '%\_residential\_listings'
                       WHEN 'Commercial'  THEN s.source_table LIKE '%\_commercial\_listings'
                       ELSE true END)))
      ))
  ),
  total AS (SELECT count(*)::int AS t FROM cohort),
  live AS (
    SELECT norm_district_tok(district_ar) AS tok, count(*)::int AS n
    FROM cohort WHERE district_ar IS NOT NULL GROUP BY 1
  ),
  cat AS (
    SELECT c.canonical_district_ar,
           regexp_replace(c.district_norm, 'ء$', '') AS fold,
           COALESCE(l.n, 0) AS n
    FROM public.loc_canonical_district c
    LEFT JOIN live l ON l.tok = c.district_norm
    WHERE c.city_id = p_city_id
  )
  SELECT (array_agg(canonical_district_ar ORDER BY n DESC, canonical_district_ar))[1] AS district_ar,
         sum(n)::int AS listing_count,
         array_agg(DISTINCT canonical_district_ar) AS match_values,
         (SELECT t FROM total) AS total_in_city
  FROM cat
  GROUP BY fold
  ORDER BY listing_count DESC, district_ar;
$function$;

grant execute on function public.district_options_ar(integer, text, text, text, text[]) to anon, authenticated, service_role;

-- mon_detect_trending_cohort_drift calls both RPCs positionally with the OLD boolean pm — must move
-- to the text token in the SAME migration or the cron detector breaks immediately. Also extend its
-- fixed probe set with genuine كلاهما (both-periods) cases so it PROVES trending-vs-results parity
-- for the combined-period feature, not just monthly/annual individually.
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
    with probe(label, deal, period, types, macro) as (values
      ('apt-rent-annual', 'إيجار', 'سنوي', array['شقة'], 'Residential'),
      ('apt-rent-monthly','إيجار', 'شهري', array['شقة'], 'Residential'),   -- barrier #9
      ('apt-rent-both',   'إيجار', 'كلاهما', array['شقة'], 'Residential'), -- owner feature 2026-08-19
      ('apt-buy',         'بيع',   null::text, array['شقة'], 'Residential'),
      ('floor-rent-annual','إيجار', 'سنوي', array['دور'], 'Residential'),
      ('floor-rent-both', 'إيجار', 'كلاهما', array['دور'], 'Residential'),
      ('building-buy',    'بيع',   null, array['عمارة'], 'Residential'),
      ('untyped-rent-annual','إيجار', 'سنوي', null::text[], 'Residential'),
      ('untyped-rent-both','إيجار', 'كلاهما', null::text[], 'Residential')
    ),
    periods(period_ar) as (values ('شهري'), ('سنوي')),
    taxonomy_probe as (
      select distinct 'taxonomy:' || k.type_ar || ':' || pr.period_ar as label,
             'إيجار'::text as deal, pr.period_ar as period,
             array[k.type_ar] as types, k.macro
      from known_type_ar k
      cross join periods pr
      where k.macro in ('Residential', 'Commercial')
        and exists (
          select 1 from search_listings_ar s
          where s.type_ar = k.type_ar and s.deal_ar = 'إيجار' and s.production_ready
            and (
              (pr.period_ar = 'شهري' and s.payment_monthly = true and not coalesce(s.rent_now_pay_later, false))
              or (pr.period_ar = 'سنوي' and (s.rent_period_ar = 'سنوي'
                   or (s.rent_period_ar = 'شهري' and coalesce(s.rent_now_pay_later, false))))
            )
        )
    ),
    all_probes as (
      select label, deal, period, types, macro from probe
      union all
      select label, deal, period, types, macro from taxonomy_probe
    )
    select p.label, p.deal, p.period, p.types, p.macro,
           tc.city_id as t_city_id, tc.city_ar, tc.region_id as t_region_id,
           tc.listing_count, tc.total_in_cohort,
           sum(tc.listing_count) over (partition by p.label) as sum_cities
    from all_probes p
    cross join lateral (
      select * from top_cities_by_deal_ar(p.deal, p.period, p.macro, p.types)
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
    -- #18 equality with the result RPC (κλαهما probes prove combined trending == combined results)
    select max(total_count) into s_cnt from location_search_candidates_ar(
      p_deal := r.deal, p_rent_period := r.period, p_types := r.types,
      p_category := r.macro, p_cities := array[r.city_ar], p_limit := 1);
    if coalesce(s_cnt, 0) <> r.listing_count then
      bad := bad || jsonb_build_object('probe', r.label, 'kind', 'city_drift',
        'city', r.city_ar, 'trending', r.listing_count, 'search', s_cnt);
    end if;
    -- top district: equality + denominator
    select dd.* into d from district_options_ar(r.t_city_id, r.deal, r.macro, r.period, r.types) dd
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
      select dd.* into d2 from district_options_ar(r.t_city_id, r.deal, r.macro, r.period, r.types) dd
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

notify pgrst, 'reload schema';
