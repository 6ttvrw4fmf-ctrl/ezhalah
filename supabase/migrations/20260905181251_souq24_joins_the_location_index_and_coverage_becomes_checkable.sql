-- souq24 IS SEARCHABLE BUT WAS ABSENT FROM listing_location_index — and nothing could tell us.
-- Found 2026-09-05 while verifying the alta/shmoualshmal activation (owner-directed follow-up).
--
-- WHAT WAS TRUE. souq24 had 44 Buy/Rent rows in active_listing_ids_v2 (42 residential + 2
-- commercial, all active) and ZERO arms in listing_location_index. It is the ONLY searchable
-- platform in that state. The two objects are activated by separate migration halves, so an
-- onboarding that wires the search union and forgets the location index looks perfectly healthy
-- from the search side — which is exactly how this survived.
--
-- WHY IT IS A REAL DEFECT EVEN THOUGH SEARCH STILL WORKED. Measured before this migration:
-- souq24's rows carry city 44/44, district 42/44, region 44/44, and there were 0 orphaned
-- search_listings_ar rows fleet-wide — listing_native_location_v2 resolves their location through
-- fallback resolvers rather than the location index. So no listing was invisible. The damage is a
-- COVERAGE hole: listing_location_index feeds listing_location_canonical, and
-- refresh_city_name_bridge / refresh_district_name_bridge read from there, so souq24 never
-- contributed its city/district spellings to the catalogs that canonicalise future listings.
--
-- Same staged build + atomic swap used on 2026-09-03 and again earlier today; every dependent,
-- index and grant restored from ops_ddl_snapshot label 'pre_souq24_lli_20260905'
-- (11 views + 2 matviews + 20 indexes + 448 grants, captured in dependency order).
--
-- MEASURED AFTER: listing_location_index 204,460 rows, souq24 44, alta+shmoualshmal still 13,
-- 0 duplicate index_ids, 20 indexes restored, ops_location_index_coverage() returns 0 rows
-- against 38 searchable platforms.
DO $do$
DECLARE base text; arms text := ''; suffix text := ') u) v'; body text; r record;
BEGIN
  IF position('souq24_residential_listings' in pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0 THEN
    base := rtrim(rtrim(pg_get_viewdef('public.listing_location_index'::regclass,true)),';');
    IF right(base, length(suffix)) <> suffix THEN
      RAISE EXCEPTION 'listing_location_index shape changed; refusing to splice';
    END IF;
    body := left(base, length(base) - length(suffix));
    FOR r IN SELECT * FROM (VALUES
        ('souq24_residential_listings','souq24','residential'),
        ('souq24_commercial_listings','souq24','commercial')
      ) AS x(tbl,slug,cat)
    LOOP
      arms := arms || format($f$
UNION ALL
 SELECT ('%1$s'::text || ':'::text) || %1$I.id::text AS index_id, %1$I.id AS listing_id,
    '%2$s'::text AS platform, '%1$s'::text AS source_table, '%3$s'::text AS category,
    lower(%1$I.transaction_type) AS purpose, %1$I.region, %1$I.city,
    %1$I.neighborhood AS district, %1$I.street_name, %1$I.direction AS facade_direction,
    %1$I.last_seen_at AS last_updated, %1$I.scraped_at AS raw_created_at,
    NULL::timestamp with time zone AS raw_updated_at, %1$I.title
   FROM %1$I
  WHERE %1$I.active = true AND (%1$I.transaction_type = ANY (ARRAY['Buy'::text,'Rent'::text]))$f$,
        r.tbl, r.slug, r.cat);
    END LOOP;
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.listing_location_index__mig CASCADE';
    EXECUTE 'CREATE MATERIALIZED VIEW public.listing_location_index__mig AS ' || body || arms || suffix;
    EXECUTE 'CREATE UNIQUE INDEX lli__mig_pk ON public.listing_location_index__mig (index_id)';
    EXECUTE 'DROP MATERIALIZED VIEW public.listing_location_index CASCADE';
    EXECUTE 'ALTER MATERIALIZED VIEW public.listing_location_index__mig RENAME TO listing_location_index';
    EXECUTE 'ALTER INDEX public.lli__mig_pk RENAME TO listing_location_index_pk';
  END IF;
END
$do$;

DO $restore$
DECLARE r record; failed text[] := '{}';
BEGIN
  FOR r IN SELECT ddl, obj_name, obj_kind FROM ops_ddl_snapshot
           WHERE label='pre_souq24_lli_20260905' ORDER BY ordinal, id
  LOOP
    BEGIN EXECUTE r.ddl;
    EXCEPTION
      WHEN duplicate_table OR duplicate_object THEN NULL;
      WHEN OTHERS THEN failed := failed || (r.obj_kind||':'||r.obj_name||' -> '||SQLERRM);
    END;
  END LOOP;
  IF cardinality(failed) > 0 THEN
    RAISE EXCEPTION 'restore incomplete (% object(s)): %', cardinality(failed), failed;
  END IF;
END
$restore$;

-- ── THE BARRIER'S EYES ────────────────────────────────────────────────────────────────────────
-- Compares the two LIVE union definitions against each other, in the database, next to the objects
-- it compares — never a list in the repo that someone must remember to update. Returns one row per
-- platform that active_listing_ids_v2 makes searchable but listing_location_index does not cover.
-- Read by scripts/verify-location-index-covers-every-searchable-platform.ts.
CREATE OR REPLACE FUNCTION public.ops_location_index_coverage(p_debug boolean DEFAULT false)
RETURNS TABLE (platform text, searchable_rows bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH searchable AS (
    SELECT split_part(v.source_table,'_',1) AS platform, count(*) AS n
    FROM active_listing_ids_v2 v
    WHERE v.transaction_type = ANY (ARRAY['Buy','Rent'])
    GROUP BY 1
  ), covered AS (
    SELECT DISTINCT l.platform FROM listing_location_index l
  )
  SELECT s.platform, s.n
  FROM searchable s
  -- p_debug=true returns EVERY searchable platform, so the barrier can prove the comparison is
  -- evaluating a non-empty set rather than passing because both sides are empty.
  WHERE p_debug OR NOT EXISTS (SELECT 1 FROM covered c WHERE c.platform = s.platform)
  ORDER BY 1;
$fn$;

REVOKE ALL ON FUNCTION public.ops_location_index_coverage(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ops_location_index_coverage(boolean) TO anon, authenticated, service_role;
