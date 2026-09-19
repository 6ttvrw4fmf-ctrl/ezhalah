-- عقاريون joins listing_age_resolved — the LAST arm its Advanced-Filter age question needs.
--
-- Found by testing, not by reading: after every launch box passed and the platform answered a
-- normal-filter search, p_age_max returned 0 while the raw table held 197 ages. property_age does
-- NOT flow through listing_extra_attrs like street width and direction do — listing_native_location_v2
-- LEFT JOINs a separate registry, listing_age_resolved, which is the platform-agnostic age
-- architecture this repo deliberately keeps apart from the per-platform attribute views. A platform
-- with no arm here has NO age, silently, while every other AF answer works.
--
-- The 0..100 bound is the shared arm shape, kept verbatim: an age outside it is a parse artefact,
-- not a property, and is dropped here rather than corrected (SOURCE IS TRUTH — we do not invent an
-- age, we decline to publish an impossible one).
DO $do$
DECLARE base text; arms text := ''; t text;
BEGIN
  IF position('akariyoun_residential_listings' in pg_get_viewdef('public.listing_age_resolved'::regclass,true)) > 0 THEN
    RAISE NOTICE 'akariyoun already in listing_age_resolved — skipping';
  ELSE
    base := rtrim(rtrim(pg_get_viewdef('public.listing_age_resolved'::regclass,true)),';');
    FOREACH t IN ARRAY ARRAY['akariyoun_residential_listings','akariyoun_commercial_listings'] LOOP
      arms := arms || format($f$
UNION ALL
 SELECT %1$L::text AS source_table,
    %1$I.id AS listing_id,
    %1$I.property_age
   FROM %1$I
  WHERE %1$I.active AND %1$I.property_age >= 0 AND %1$I.property_age <= 100$f$, t);
    END LOOP;
    EXECUTE 'CREATE OR REPLACE VIEW public.listing_age_resolved AS ' || base || arms;
    EXECUTE 'GRANT ALL ON public.listing_age_resolved TO postgres, anon, authenticated, service_role';
  END IF;
END
$do$;

DO $verify$
DECLARE n int;
BEGIN
  IF position('akariyoun_residential_listings' in pg_get_viewdef('public.listing_age_resolved'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'akariyoun did not land in listing_age_resolved';
  END IF;
  IF position('aqar_residential_listings' in pg_get_viewdef('public.listing_age_resolved'::regclass,true)) = 0 THEN
    RAISE EXCEPTION 'an existing platform arm was dropped while adding akariyoun';
  END IF;
  SELECT count(*) INTO n FROM public.listing_age_resolved
   WHERE source_table = 'akariyoun_residential_listings';
  IF n = 0 THEN
    RAISE EXCEPTION 'the akariyoun arm returned no rows — the arm is wired but empty';
  END IF;
  RAISE NOTICE 'akariyoun ages resolved: %', n;
END
$verify$;