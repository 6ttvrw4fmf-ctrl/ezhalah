-- Cohort-aware Trending locations (owner, 2026-08-15).
--
-- Trending cities/districts must react to the user's PROPERTY context — category → type(s) → deal →
-- period — and never to price. Both RPCs already scope deal/period/category and already read the
-- SAME table + production_ready gate as search (search_listings_ar), so counts cannot drift from
-- search by construction. This adds the one missing dimension (p_types, the identical parameter the
-- search RPC takes) and an EXACT denominator so the UI can show honest percentages:
--
--   city %     = listings in city ÷ ALL eligible listings in the cohort   (total_in_cohort)
--   district % = listings in district ÷ ALL eligible in city + cohort     (total_in_city)
--
-- Denominator decision (verified live 2026-08-15): the district denominator includes rows with NO
-- district (الرياض شقة/سنوي: 9,906 total, 9,899 with district, 7 without). Percentages therefore
-- sum to <100% by the size of the unknown-district remainder — honest, because the number means
-- "share of what clicking the CITY returns", not "share of districted rows".
--
-- Signature change = new return column + new trailing defaulted param, so: DROP the old signatures
-- FIRST in the same transaction (CREATE OR REPLACE with a different arg list would create a second
-- OVERLOAD — the PGRST203 outage class), then CREATE. Existing callers keep working: the deployed
-- frontend calls with named-arg subsets (defaults fill the rest) and ignores extra columns; the two
-- mon_* barriers call with fewer args.
--
-- NOTE: the period clause below was corrected 22 minutes later by
-- 20260815231213_trending_period_semantics_mirror_search_rnpl_annual.sql (RNPL rows are ANNUAL in
-- search; this first version missed them — caught by the drift probe on day one). Committed as
-- applied, for migration-history parity.

drop function if exists public.top_cities_by_deal_ar(text, boolean, text);
drop function if exists public.district_options_ar(integer, text, text, boolean);

create function public.top_cities_by_deal_ar(
  p_deal text,
  p_payment_monthly boolean default null,
  p_category text default null,
  p_types text[] default null
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
          OR (p_payment_monthly = true  AND s.payment_monthly = true)
          OR (p_payment_monthly = false AND (s.deal_ar <> 'إيجار' OR s.rent_period_ar = 'سنوي')))
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

create function public.district_options_ar(
  p_city_id integer,
  p_deal text default null,
  p_category text default null,
  p_payment_monthly boolean default null,
  p_types text[] default null
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
        OR (p_payment_monthly = true  AND s.payment_monthly = true)
        OR (p_payment_monthly = false AND (s.deal_ar <> 'إيجار' OR s.rent_period_ar = 'سنوي')))
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
    FROM cohort WHERE district_ar IS NOT NULL
    GROUP BY 1
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

-- PostgREST must see the new signatures immediately (postgrest-reload-gotcha).
notify pgrst, 'reload schema';
