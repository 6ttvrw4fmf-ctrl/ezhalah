-- Period-scope the trending City / District ranking functions (owner request 2026-07-21).
--
-- Adds an OPTIONAL p_payment_monthly filter so the "Trending cities/districts" lists — and the new
-- proactive trending chips above the City field — reflect the Monthly vs Annual rent period the user
-- picked. Monthly and annual top-lists genuinely differ (e.g. ابها / حائل / تبوك rank in the monthly
-- Rent top-8 but not the annual one; يرموك is the #1 monthly Riyadh district but the #1 annual one is
-- النرجس). payment_monthly is the canonical period-truth field (project rule: Monthly=REAL(payment_monthly
-- =true), Yearly=rest).
--
-- BACKWARD-COMPATIBLE: the new argument DEFAULTs to NULL, and NULL means "no period filter" —
-- byte-identical to the prior behavior. We DROP the old signature and CREATE a single new function
-- (rather than leaving both overloads to coexist) so a name-based PostgREST call that omits the arg
-- still resolves to exactly ONE function — this avoids the PGRST203 "function is not unique" hazard
-- that a defaulted-extra-arg overload would otherwise create. Any existing caller that omits the arg
-- keeps working unchanged. Bodies below are byte-faithful to the live pg_get_functiondef output;
-- the only edits are the new parameter, the single period predicate, DROP+re-GRANT, and NOTIFY.
--
-- Verified before writing: 0 dependents on either function (safe to DROP); anon/authenticated/
-- service_role held EXECUTE (re-granted below); NOTIFY reloads PostgREST's function-signature cache.

-- ── top_cities_by_deal_ar ────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.top_cities_by_deal_ar(text);
CREATE OR REPLACE FUNCTION public.top_cities_by_deal_ar(p_deal text, p_payment_monthly boolean DEFAULT NULL)
 RETURNS TABLE(city_id integer, city_ar text, region_id integer, region_ar text, listing_count integer)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT s.city_id, c.city_ar, c.region_id, r.region_ar, count(*)::int AS listing_count
  FROM search_listings_ar s
    JOIN loc_catalog_city c ON c.city_id = s.city_id
    LEFT JOIN loc_catalog_region r ON r.region_id = c.region_id
  WHERE s.production_ready = true AND s.deal_ar = p_deal
    AND (p_payment_monthly IS NULL OR s.payment_monthly = p_payment_monthly)
  GROUP BY s.city_id, c.city_ar, c.region_id, r.region_ar
  ORDER BY listing_count DESC;
$function$;
GRANT EXECUTE ON FUNCTION public.top_cities_by_deal_ar(text, boolean) TO anon, authenticated, service_role;

-- ── district_options_ar ──────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.district_options_ar(integer, text, text);
CREATE OR REPLACE FUNCTION public.district_options_ar(p_city_id integer, p_deal text DEFAULT NULL, p_category text DEFAULT NULL, p_payment_monthly boolean DEFAULT NULL)
 RETURNS TABLE(district_ar text, listing_count integer, match_values text[])
 LANGUAGE sql
 STABLE
AS $function$
  WITH live AS (
    SELECT norm_district_tok(s.district_ar) AS tok, count(*)::int AS n
    FROM public.search_listings_ar s
    WHERE s.city_id = p_city_id AND s.production_ready AND s.district_ar IS NOT NULL
      AND (p_deal IS NULL OR s.deal_ar = p_deal)
      AND (p_payment_monthly IS NULL OR s.payment_monthly = p_payment_monthly)
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
GRANT EXECUTE ON FUNCTION public.district_options_ar(integer, text, text, boolean) TO anon, authenticated, service_role;

-- PostgREST caches function signatures; a changed signature needs a schema reload to be callable via
-- RPC (project memory: postgrest-reload-gotcha).
NOTIFY pgrst, 'reload schema';
