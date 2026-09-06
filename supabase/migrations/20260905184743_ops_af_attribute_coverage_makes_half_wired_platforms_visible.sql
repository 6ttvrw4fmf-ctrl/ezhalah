-- THE EYES FOR scripts/verify-af-attribute-views-cover-every-platform.ts.
--
-- Returns one row per SEARCHABLE platform with whether it appears in each of the two Advanced
-- Filter attribute views. Built after awal was found searchable with only half its AF wiring —
-- 51 rows in listing_extra_attrs, 0 in listing_rich_attrs — which nothing could see, because
-- area/price/bedrooms/bathrooms travel through active_listing_ids_v2 and made search look healthy.
--
-- PERFORMANCE IS THE DESIGN CONSTRAINT, NOT AN OPTIMISATION. The first version of this check lived
-- inline in a migration and called pg_get_viewdef() once PER platform against a ~270KB definition;
-- it hit the statement timeout and rolled its own migration back. Here each definition is fetched
-- EXACTLY ONCE into a CTE and every platform is tested against those two strings.
CREATE OR REPLACE FUNCTION public.ops_af_attribute_coverage()
RETURNS TABLE (platform text, in_rich boolean, in_extra boolean, searchable_rows bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH defs AS (
    SELECT pg_get_viewdef('public.listing_rich_attrs'::regclass, true)  AS rich,
           pg_get_viewdef('public.listing_extra_attrs'::regclass, true) AS extra
  ), searchable AS (
    SELECT split_part(v.source_table,'_',1) AS platform, count(*) AS n
    FROM active_listing_ids_v2 v
    GROUP BY 1
  )
  SELECT s.platform,
         (position(s.platform||'_residential_listings' in d.rich) > 0
          OR position(s.platform||'_commercial_listings' in d.rich) > 0)  AS in_rich,
         (position(s.platform||'_residential_listings' in d.extra) > 0
          OR position(s.platform||'_commercial_listings' in d.extra) > 0) AS in_extra,
         s.n
  FROM searchable s CROSS JOIN defs d
  ORDER BY s.platform;
$fn$;

REVOKE ALL ON FUNCTION public.ops_af_attribute_coverage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ops_af_attribute_coverage() TO anon, authenticated, service_role;
