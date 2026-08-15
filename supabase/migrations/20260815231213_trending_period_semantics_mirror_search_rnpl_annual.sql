-- Trending must count EXACTLY what search returns (owner barrier #18: count RPC and result RPC
-- cannot drift). Caught live within minutes of the first migration: trending said الرياض شقة/سنوي
-- = 9,906 while the search RPC returns 9,907. The missing row (aqar 23235) is rent_period_ar='شهري'
-- with rent_now_pay_later=true — an RNPL listing, which the fleet-wide period rule classifies as
-- ANNUAL (an RNPL instalment is a payment plan on an annual lease; PR #367 closed the reverse
-- window on the Monthly side). The search RPC was updated accordingly; BOTH trending functions
-- still carried the older clause — the pre-existing district_options_ar included, so this fixes a
-- drift that predates today.
--
-- Live search semantics mirrored verbatim:
--   monthly (p_payment_monthly=true) : payment_monthly AND NOT rnpl
--   annual  (p_payment_monthly=false): deal<>'إيجار' OR rent_period_ar='سنوي'
--                                      OR (rent_period_ar='شهري' AND rnpl)
-- Same signatures, so CREATE OR REPLACE is safe (no overload risk).

create or replace function public.top_cities_by_deal_ar(
  p_deal text, p_payment_monthly boolean default null,
  p_category text default null, p_types text[] default null
)
returns table(city_id integer, city_ar text, region_id integer, region_ar text,
              listing_count integer, total_in_cohort integer)
language sql stable as $function$
  WITH valid_category AS (
    SELECT CASE WHEN p_category IN ('Residential','Commercial') THEN p_category ELSE NULL END AS v
  ),
  cohort AS (
    SELECT s.city_id
    FROM search_listings_ar s CROSS JOIN valid_category
    WHERE s.production_ready = true AND s.deal_ar = p_deal
      AND (p_payment_monthly IS NULL
          OR (p_payment_monthly = true  AND s.payment_monthly = true AND NOT coalesce(s.rent_now_pay_later, false))
          OR (p_payment_monthly = false AND (s.deal_ar <> 'إيجار' OR s.rent_period_ar = 'سنوي'
               OR (s.rent_period_ar = 'شهري' AND coalesce(s.rent_now_pay_later, false)))))
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

create or replace function public.district_options_ar(
  p_city_id integer, p_deal text default null, p_category text default null,
  p_payment_monthly boolean default null, p_types text[] default null
)
returns table(district_ar text, listing_count integer, match_values text[], total_in_city integer)
language sql stable as $function$
  WITH valid_category AS (
    SELECT CASE WHEN p_category IN ('Residential','Commercial') THEN p_category ELSE NULL END AS v
  ),
  cohort AS (
    SELECT s.district_ar
    FROM public.search_listings_ar s CROSS JOIN valid_category
    WHERE s.city_id = p_city_id AND s.production_ready
      AND (p_deal IS NULL OR s.deal_ar = p_deal)
      AND (p_payment_monthly IS NULL
        OR (p_payment_monthly = true  AND s.payment_monthly = true AND NOT coalesce(s.rent_now_pay_later, false))
        OR (p_payment_monthly = false AND (s.deal_ar <> 'إيجار' OR s.rent_period_ar = 'سنوي'
             OR (s.rent_period_ar = 'شهري' AND coalesce(s.rent_now_pay_later, false)))))
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

notify pgrst, 'reload schema';
