-- Context-aware Top Cities / Top Districts — 2026-07-20
-- =============================================================================================
-- Owner ask: the City/District field's default "Top 6" suggestions come from a single global
-- (all-deals, all-categories) ranking (city_listing_counts_ar / district_options_ar), so a
-- Commercial+Buy searcher sees the same order as a Residential+Rent one. Verified live the two
-- genuinely differ (2026-07-20 read-only check): Buy top-6 cities are الرياض،جدة،الدمام،الخبر،
-- مكة المكرمة،المدينة المنورة; Rent top-6 are الرياض،جدة،الخبر،الدمام،المدينة المنورة،مكة المكرمة —
-- Khobar/Madinah swap ahead of Dammam/Makkah specifically for Rent. District-level differences are
-- larger still (Riyadh Buy top-6 districts and Rent top-6 districts share only 3 of 6 entries).
--
-- SCOPE DECISION (resolved with the owner 2026-07-20): the guided form picks Deal BEFORE City/
-- District, but Category only AFTER — so a true Category×Deal (4-way) ranking cannot reach the
-- City/District pickers under the current step order without moving Category earlier, which the
-- owner explicitly declined (bigger, unrelated UX change). This migration scopes Top Cities/
-- Districts by DEAL ONLY (Buy vs Rent) — the dimension actually available at that step.
--
-- CHANGES:
--   1. New function top_cities_by_deal_ar(p_deal) — same shape/columns as the city_listing_counts_ar
--      view it complements, but grouped by deal_ar. The plain view is UNTOUCHED (still used nowhere
--      after this ships, but not dropped, in case anything else references it).
--   2. district_options_ar(p_city_id, p_deal DEFAULT NULL) — the live function gets ONE new
--      parameter with a safe default. p_deal IS NULL preserves the exact prior behavior byte-for-
--      byte (verified below); every existing caller that only passes p_city_id is unaffected.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.top_cities_by_deal_ar(p_deal text)
 RETURNS TABLE(city_id integer, city_ar text, region_id integer, region_ar text, listing_count integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT s.city_id, c.city_ar, c.region_id, r.region_ar, count(*)::int AS listing_count
  FROM search_listings_ar s
    JOIN loc_catalog_city c ON c.city_id = s.city_id
    LEFT JOIN loc_catalog_region r ON r.region_id = c.region_id
  WHERE s.production_ready = true AND s.deal_ar = p_deal
  GROUP BY s.city_id, c.city_ar, c.region_id, r.region_ar
  ORDER BY listing_count DESC;
$function$;

-- Live definition immediately before this migration (pulled via pg_get_functiondef, 2026-07-19),
-- reproduced here verbatim except for the added parameter and its one new predicate — everything
-- else, including comments-worth column order and the hamza-fold GROUP BY, is unchanged:
CREATE OR REPLACE FUNCTION public.district_options_ar(p_city_id integer, p_deal text DEFAULT NULL::text)
 RETURNS TABLE(district_ar text, listing_count integer, match_values text[])
 LANGUAGE sql
 STABLE
AS $function$
  WITH live AS (
    SELECT norm_district_tok(district_ar) AS tok, count(*)::int AS n
    FROM public.search_listings_ar
    WHERE city_id = p_city_id AND production_ready AND district_ar IS NOT NULL
      AND (p_deal IS NULL OR deal_ar = p_deal)
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
         array_agg(DISTINCT canonical_district_ar) AS match_values
  FROM cat
  GROUP BY fold
  ORDER BY listing_count DESC, district_ar;
$function$;

-- =============================================================================================
-- VERIFIED (read-only, live, 2026-07-20):
--   - district_options_ar(city_id, NULL) reproduces district_options_ar(city_id)'s pre-migration
--     output exactly, row for row (checked against Riyadh, city_id=3).
--   - top_cities_by_deal_ar('بيع') vs ('إيجار') and district_options_ar(3,'بيع') vs (3,'إيجار')
--     each produce genuinely different top-6 orderings (numbers in the header comment above).
-- ROLLBACK: DROP FUNCTION public.top_cities_by_deal_ar(text);
--           then re-run the verbatim pre-migration district_options_ar(p_city_id integer) body
--           (identical SQL above, minus the p_deal parameter and its one predicate line) to restore
--           the single-argument signature — or simply leave the two-argument version in place and
--           stop passing p_deal from the client; NULL reproduces the old behavior exactly.
-- =============================================================================================
