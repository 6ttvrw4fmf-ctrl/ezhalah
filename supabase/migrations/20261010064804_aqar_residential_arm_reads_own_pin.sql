-- Aqar residential: read the ad's own map pin into listing_rich_attrs (→ search_listings_ar.latitude/longitude).
-- The enricher now writes aqar's own `listing.location` as additional_info {latitude, longitude}
-- (scrapers/aqar/enrich_residential.py::_own_coordinates, Saudi-box checked). The aqar COMMERCIAL arm
-- already reads that generic shape; the RESIDENTIAL arm hard-coded NULL, so aqar showed 0% coordinates.
-- Only the residential arm changes: its two NULL columns become a guarded read of that shape, with the
-- Saudi box (lat 16–33, lng 34–56) so (0,0) or a swapped pair can never reach the map. Nested CASE so
-- the numeric cast only ever sees a value the regex accepted. Body read LIVE at apply time; the same
-- short-lock retry loop as the batch migrations.
set local statement_timeout = '5min';
DO $do$
DECLARE d text; head text; tail text; cut int; i int; ok boolean := false;
  old_cols constant text := E'    NULL::numeric AS latitude,\n    NULL::numeric AS longitude,\n';
  new_cols constant text := E'        CASE\n            WHEN (a.additional_info ->> ''latitude''::text) ~ ''^[0-9]+(\\.[0-9]+)?$''::text AND (a.additional_info ->> ''longitude''::text) ~ ''^[0-9]+(\\.[0-9]+)?$''::text THEN\n                CASE WHEN ((a.additional_info ->> ''latitude''::text)::numeric) BETWEEN 16::numeric AND 33::numeric\n                      AND ((a.additional_info ->> ''longitude''::text)::numeric) BETWEEN 34::numeric AND 56::numeric\n                THEN (a.additional_info ->> ''latitude''::text)::numeric ELSE NULL::numeric END\n            ELSE NULL::numeric\n        END AS latitude,\n        CASE\n            WHEN (a.additional_info ->> ''latitude''::text) ~ ''^[0-9]+(\\.[0-9]+)?$''::text AND (a.additional_info ->> ''longitude''::text) ~ ''^[0-9]+(\\.[0-9]+)?$''::text THEN\n                CASE WHEN ((a.additional_info ->> ''latitude''::text)::numeric) BETWEEN 16::numeric AND 33::numeric\n                      AND ((a.additional_info ->> ''longitude''::text)::numeric) BETWEEN 34::numeric AND 56::numeric\n                THEN (a.additional_info ->> ''longitude''::text)::numeric ELSE NULL::numeric END\n            ELSE NULL::numeric\n        END AS longitude,\n';
BEGIN
  FOR i IN 1..20 LOOP
    BEGIN
      SET LOCAL lock_timeout = '3s';
      d := rtrim(rtrim(pg_get_viewdef('public.listing_rich_attrs'::regclass,true)),';');
      cut := position('UNION ALL' in d);
      head := left(d, cut - 1); tail := substr(d, cut);
      IF position('FROM aqar_residential_listings a' in head) = 0 THEN
        RAISE EXCEPTION 'first arm of listing_rich_attrs is no longer aqar_residential_listings — re-read before applying';
      END IF;
      IF position('a.additional_info ->> ''latitude''' in head) > 0 THEN
        RAISE NOTICE 'aqar residential arm already reads its pin'; RETURN;
      END IF;
      IF position(old_cols in head) = 0 THEN
        RAISE EXCEPTION 'aqar residential arm no longer has the NULL latitude/longitude pair — re-read before applying';
      END IF;
      EXECUTE 'CREATE OR REPLACE VIEW public.listing_rich_attrs AS ' || replace(head, old_cols, new_cols) || tail;
      EXECUTE 'GRANT ALL ON public.listing_rich_attrs TO postgres, anon, authenticated, service_role';
      ok := true;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(2);
    END;
  END LOOP;
  IF NOT ok THEN
    RAISE EXCEPTION 'could not acquire ACCESS EXCLUSIVE on listing_rich_attrs after 20 short attempts - traffic never gapped; retry later';
  END IF;
END
$do$;
