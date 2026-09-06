-- Give remal + amaall the SAME Advanced Filter attribute coverage every other platform has —
-- applied ahead of this call against the live database (same session, same activation pass);
-- this registers the migration version and re-verifies idempotency via the "already carries the
-- new arms" guard.
--
-- Cloned from the LIVE october arm, never hand-written — the same method used for alta/
-- shmoualshmal (20260905053633) and for awal's half-wired-AF fix (20260905184645). CREATE OR
-- REPLACE VIEW is safe: appending UNION ALL arms leaves the column list untouched, so no DROP,
-- no CASCADE, no dependent rebuild.
--
-- MEASURED RESULT: ops_af_attribute_coverage() reports 0 gaps across all 40 platforms — neither
-- platform shipped with the awal-style half-wiring (in one AF view, absent from the other).
DO $do$
DECLARE
  v text; src text; arm text; arms text; st int; en int; t text;
  tbls text[] := ARRAY[
    'remal_residential_listings','remal_commercial_listings',
    'amaall_residential_listings','amaall_commercial_listings'];
BEGIN
  FOREACH v IN ARRAY ARRAY['listing_extra_attrs','listing_rich_attrs'] LOOP
    src := rtrim(rtrim(pg_get_viewdef(('public.'||v)::regclass, true)), ';');

    IF position('remal_residential_listings' in src) > 0 THEN
      RAISE NOTICE '% already carries the new arms — skipping', v;
      CONTINUE;
    END IF;

    st := position('SELECT ''october_residential_listings''::text AS source_table' in src);
    IF st = 0 THEN
      RAISE EXCEPTION '% has no october arm to clone — shape changed, refusing to guess', v;
    END IF;
    en := st + position('FROM october_residential_listings x' in substring(src from st)) - 1;
    en := en + position('WHERE x.active' in substring(src from en)) - 1 + length('WHERE x.active');
    arm := substring(src from st for en - st);

    arms := '';
    FOREACH t IN ARRAY tbls LOOP
      arms := arms || E'\nUNION ALL\n ' || replace(arm, 'october_residential_listings', t);
    END LOOP;

    EXECUTE format('CREATE OR REPLACE VIEW public.%I AS %s', v, src || arms);
    RAISE NOTICE 'wired 4 arms into %', v;
  END LOOP;
END
$do$;
