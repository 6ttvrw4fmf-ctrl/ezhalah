-- Context-aware Top Cities / Top Districts — 2026-07-20
-- =============================================================================================
-- Owner ask: the City/District field's default "Top 6" suggestions come from a single global
-- (all-deals, all-categories) ranking (city_listing_counts_ar / district_options_ar), so a
-- Commercial+Buy searcher sees the same order as a Residential+Rent one. Verified live the two
-- genuinely differ (2026-07-20 read-only check): Buy top-6 cities are الرياض،جدة،الدمام،الخبر،
-- مكة المكرمة،المدينة المنورة; Rent top-6 are الرياض،جدة،الخبر،الدمام،المدينة المنورة،مكة المكرمة —
-- Khobar/Madinah swap ahead of Dammam/Makkah specifically for Rent.
--
-- CITIES: the guided form picks Deal BEFORE City, but Category only AFTER City/District — so a
-- Category×Deal ranking cannot reach the City picker under the current step order without moving
-- Category earlier, which the owner explicitly declined (bigger, unrelated UX change). Cities stay
-- DEAL-ONLY scoped — the dimension actually available at that step, and city-level Category
-- differences are minor anyway (same 6 cities, just reordered).
--
-- DISTRICTS: a follow-up owner-commissioned check (Riyadh, city_id=3, read-only, 2026-07-20) proved
-- Category matters FAR more for districts than for cities. Top-10 overlap between scopes: Residential
-- Buy vs Residential Rent 6/10; Residential Buy vs Commercial Buy 6/10; every pairing involving
-- Commercial+Rent drops to 4/10. Commercial+Rent's own top district (حي السويدي, 323 listings) and
-- three others in its top 10 (الدريهمية، السلي، الروضة) appear in NONE of the other three scopes'
-- top 10 at all — commercial rental demand concentrates in genuinely different geography (e.g. حي
-- العليا, Riyadh's business-district core) than residential does.
--
-- OWNER DECISION (2026-07-20): still do NOT reorder the form — Category stays after District. Instead,
-- District's Top-6 is Category×Deal aware (4-way) and RE-FETCHES/REFRESHES the moment either Deal or
-- Category changes later in the flow, even after District was already rendered once with a narrower
-- (Deal-only) scope. When Category hasn't been picked yet, p_category stays NULL and the ranking
-- falls back to the broader Deal-only scope — "acceptable... until enough information is available."
--
-- CHANGES:
--   1. New function top_cities_by_deal_ar(p_deal) — same shape/columns as the city_listing_counts_ar
--      view it complements, but grouped by deal_ar. The plain view is UNTOUCHED (still used nowhere
--      after this ships, but not dropped, in case anything else references it).
--   2. district_options_ar(p_city_id, p_deal DEFAULT NULL, p_category DEFAULT NULL) — the live
--      function gets TWO new parameters, both defaulted. Both NULL preserves the exact prior global
--      behavior byte-for-byte (verified below); p_category filters via known_type_ar exactly like
--      property_age_option_counts_ar already does elsewhere in this schema (macro = p_category OR
--      macro = 'both') — same pattern, not a new one.
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

-- Original live definition (pulled via pg_get_functiondef, 2026-07-19) reproduced here verbatim
-- except for the two added parameters and their two new predicates — everything else, including
-- column order and the hamza-fold GROUP BY, is unchanged:
CREATE OR REPLACE FUNCTION public.district_options_ar(p_city_id integer, p_deal text DEFAULT NULL::text, p_category text DEFAULT NULL::text)
 RETURNS TABLE(district_ar text, listing_count integer, match_values text[])
 LANGUAGE sql
 STABLE
AS $function$
  WITH live AS (
    SELECT norm_district_tok(s.district_ar) AS tok, count(*)::int AS n
    FROM public.search_listings_ar s
    WHERE s.city_id = p_city_id AND s.production_ready AND s.district_ar IS NOT NULL
      AND (p_deal IS NULL OR s.deal_ar = p_deal)
      AND (p_category IS NULL OR EXISTS (
        SELECT 1 FROM known_type_ar k WHERE k.type_ar = s.type_ar AND (k.macro = p_category OR k.macro = 'both')
      ))
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
--   - district_options_ar(city_id) with both new params NULL reproduces the original single-argument
--     function's output exactly, row for row (checked against Riyadh, city_id=3).
--   - top_cities_by_deal_ar('بيع') vs ('إيجار') and district_options_ar(3,'بيع') vs (3,'إيجار')
--     each produce genuinely different top-6 orderings (numbers in the header comment above).
--   - district_options_ar(3,'بيع','Residential') and (3,'إيجار','Commercial') each reproduce the
--     exact Top-10 lists from the owner-commissioned scope-divergence check above.
-- ROLLBACK: DROP FUNCTION public.top_cities_by_deal_ar(text);
--           CREATE OR REPLACE FUNCTION public.district_options_ar(p_city_id integer) — the original
--           single-argument body is identical to the one above minus p_deal/p_category and their two
--           predicate lines — or simply leave this signature in place and stop passing p_deal/
--           p_category from the client; both NULL reproduces the original global behavior exactly.
-- =============================================================================================
