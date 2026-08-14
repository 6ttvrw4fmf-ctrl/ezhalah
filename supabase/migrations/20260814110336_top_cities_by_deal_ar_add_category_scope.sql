-- top_cities_by_deal_ar gains p_category so the City field's pool counts the SAME population the
-- results RPC searches (count-scope audit 2026-08-14: pools counted ALL categories while results
-- default to Residential — city counts overstated, e.g. الرس Buy 133 shown vs 63 searchable, and one
-- district 86% over; district_options_ar already accepts p_category and proved EXACT 12/12 parity
-- when aligned). The category predicate below is copied VERBATIM from the live district_options_ar
-- (the proven-parity implementation) so the two pools can never disagree on what a category means.
-- New parameter = new signature = NEW OVERLOAD: the old 2-arg function is dropped in the SAME
-- transaction (CREATE OR REPLACE overload hazard rule); existing 2-named-arg clients keep resolving
-- to this function via the default.
DROP FUNCTION IF EXISTS public.top_cities_by_deal_ar(text, boolean);

CREATE FUNCTION public.top_cities_by_deal_ar(
  p_deal text,
  p_payment_monthly boolean DEFAULT NULL::boolean,
  p_category text DEFAULT NULL::text)
 RETURNS TABLE(city_id integer, city_ar text, region_id integer, region_ar text, listing_count integer)
 LANGUAGE sql
 STABLE
AS $function$
  WITH valid_category AS (
    SELECT CASE WHEN p_category IN ('Residential','Commercial') THEN p_category ELSE NULL END AS v
  )
  SELECT s.city_id, c.city_ar, c.region_id, r.region_ar, count(*)::int AS listing_count
  FROM search_listings_ar s
    JOIN loc_catalog_city c ON c.city_id = s.city_id
    LEFT JOIN loc_catalog_region r ON r.region_id = c.region_id
    CROSS JOIN valid_category
  WHERE s.production_ready = true AND s.deal_ar = p_deal
    AND (p_payment_monthly IS NULL
        OR (p_payment_monthly = true  AND s.payment_monthly = true)
        OR (p_payment_monthly = false AND (s.deal_ar <> 'إيجار' OR s.rent_period_ar = 'سنوي')))
    AND (valid_category.v IS NULL OR EXISTS (
        SELECT 1 FROM known_type_ar k WHERE k.type_ar = s.type_ar AND (k.macro = valid_category.v
                 OR (k.macro = 'both' AND (CASE valid_category.v
                       WHEN 'Residential' THEN s.source_table LIKE '%\_residential\_listings'
                       WHEN 'Commercial'  THEN s.source_table LIKE '%\_commercial\_listings'
                       ELSE true END)))
      ))
  GROUP BY s.city_id, c.city_ar, c.region_id, r.region_ar
  ORDER BY listing_count DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.top_cities_by_deal_ar(text, boolean, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
