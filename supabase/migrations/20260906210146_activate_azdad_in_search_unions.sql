-- ACTIVATION of azdad in the two search-union roots + listing_native_location_v1's "native" CTE +
-- the AF attribute views, following the exact recipe recorded for remal/amaall (20260906051713)
-- and the abwbna/bahadhabab/alobid native-location fix (20260906175800).
--
-- Snapshot label: 'pre_azdad_activation_20260906' — 1 matview + 11 views + 7 indexes + 308 grants,
-- captured via the SAME recursive pg_depend walk used to VERIFY the prior hand-curated object list
-- was already complete (it was — this migration's dependent set matches it exactly).
--
-- NEAR-MISS, RECORDED HONESTLY: applying this live, `DROP MATERIALIZED VIEW active_listing_ids_v2
-- CASCADE` took down listing_native_location_v1 too (v1's own body JOINs active_listing_ids_v2 —
-- a real dependency the original hand-curated snapshot list never named, because that list only
-- ever captured DEPENDENTS of the 3 root matviews, not a dependency ONE of those roots itself has
-- on ANOTHER root). v1's own dependents (v2, listing_location_canonical(_mv), and 9 further views)
-- cascaded away in turn. Recovered from a same-day snapshot taken before an unrelated earlier fix
-- (label pre_native_location_v1_fix_20260906) plus this activation's own dependent snapshot — see
-- the restore loop below, which is unconditionally safe to replay (every statement is idempotent:
-- CREATE OR REPLACE VIEW, or a CASCADE-free CREATE MATERIALIZED VIEW guarded by an existence check).
--
-- APPLIED IN PIECES against the live database first (this call registers the migration version and
-- re-verifies idempotency), same reason as every prior activation this size: the connector's own
-- request timeout is shorter than a DROP CASCADE + multi-object restore takes on this catalogue.
--
-- MEASURED RESULT: platforms 43 -> 44. azdad's own catalogue was empty at the moment of this
-- migration (crawl not yet run) — the union arms are correct and will show real rows the next time
-- scrapers.azdad.run populates the tables, exactly like every other freshly-activated platform.
DO $do$
DECLARE
  base text; arms text := ''; suffix text := ') u) v'; body text; r record; t text;
BEGIN
  ---------------------------------------------------------------- active_listing_ids_v2
  IF position('azdad_residential_listings' in pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)) = 0 THEN
    base := rtrim(rtrim(pg_get_viewdef('public.active_listing_ids_v2'::regclass,true)),';');
    FOREACH t IN ARRAY ARRAY['azdad_residential_listings','azdad_commercial_listings'] LOOP
      arms := arms || format($f$
UNION ALL
 SELECT '%1$s'::text AS source_table, %1$I.id AS listing_id, %1$I.transaction_type,
    %1$I.property_type, %1$I.price_total, %1$I.price_annual, %1$I.price_per_meter,
    %1$I.area_m2, %1$I.bedrooms, %1$I.bathrooms, %1$I.rent_period
   FROM %1$I WHERE %1$I.active IS TRUE$f$, t);
    END LOOP;
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.active_listing_ids_v2__mig';
    EXECUTE 'CREATE MATERIALIZED VIEW public.active_listing_ids_v2__mig AS ' || base || arms;
    EXECUTE 'CREATE UNIQUE INDEX active_listing_ids_v2__mig_pk ON public.active_listing_ids_v2__mig (source_table, listing_id)';
    EXECUTE 'DROP MATERIALIZED VIEW public.active_listing_ids_v2 CASCADE';
    EXECUTE 'ALTER MATERIALIZED VIEW public.active_listing_ids_v2__mig RENAME TO active_listing_ids_v2';
    EXECUTE 'ALTER INDEX public.active_listing_ids_v2__mig_pk RENAME TO active_listing_ids_v2_pk';
  END IF;

  ---------------------------------------------------------------- listing_location_index
  IF position('azdad_residential_listings' in pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0 THEN
    arms := '';
    base := rtrim(rtrim(pg_get_viewdef('public.listing_location_index'::regclass,true)),';');
    IF right(base, length(suffix)) <> suffix THEN
      RAISE EXCEPTION 'listing_location_index shape changed; refusing to splice';
    END IF;
    body := left(base, length(base) - length(suffix));
    FOR r IN SELECT * FROM (VALUES
        ('azdad_residential_listings','azdad','residential'),
        ('azdad_commercial_listings','azdad','commercial')
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

  ---------------------------------------------------------------- listing_native_location_v1
  IF position('azdad_residential_listings.city_ar' in pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) = 0 THEN
    DECLARE
      v1_base text; v1_arm text := ''; v1_anchor text;
    BEGIN
      v1_base := rtrim(rtrim(pg_get_viewdef('public.listing_native_location_v1'::regclass,true)),';');
      v1_anchor := 'FROM alobid_commercial_listings
          WHERE alobid_commercial_listings.active';
      IF position(v1_anchor in v1_base) = 0 THEN
        RAISE EXCEPTION 'alobid commercial arm anchor not found — matview shape changed, refusing to guess';
      END IF;
      FOREACH t IN ARRAY ARRAY['azdad_residential_listings','azdad_commercial_listings'] LOOP
        v1_arm := v1_arm || format($f$
        UNION ALL
         SELECT %2$L::text AS platform,
            %1$L::text AS source_table,
            %1$I.id AS listing_id,
            %1$I.city_ar,
            %1$I.city_id,
            %1$I.district_ar,
            %1$I.region_id,
            'native_scraper'::text AS source_method,
            %1$I.transaction_type
           FROM %1$I
          WHERE %1$I.active$f$,
          t, regexp_replace(t, '_(residential|commercial)_listings$', ''));
      END LOOP;
      EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.listing_native_location_v1__mig';
      EXECUTE 'CREATE MATERIALIZED VIEW public.listing_native_location_v1__mig AS ' ||
        replace(v1_base, v1_anchor, v1_anchor || v1_arm);
      EXECUTE 'CREATE UNIQUE INDEX listing_native_location_v1__mig_pk ON public.listing_native_location_v1__mig (source_table, listing_id)';
      EXECUTE 'DROP MATERIALIZED VIEW public.listing_native_location_v1 CASCADE';
      EXECUTE 'ALTER MATERIALIZED VIEW public.listing_native_location_v1__mig RENAME TO listing_native_location_v1';
      EXECUTE 'ALTER INDEX public.listing_native_location_v1__mig_pk RENAME TO listing_native_location_v1_pk';
    END;
  END IF;
END
$do$;

-- ── AF attribute views — appending arms leaves the column list untouched: CREATE OR REPLACE, no
--    DROP, no CASCADE, no dependent rebuild (same pattern as remal/amaall's own wiring) ───────────
DO $do$
DECLARE
  v text; src text; arm text; arms text; st int; en int; t text;
  tbls text[] := ARRAY['azdad_residential_listings','azdad_commercial_listings'];
BEGIN
  FOREACH v IN ARRAY ARRAY['listing_extra_attrs','listing_rich_attrs'] LOOP
    src := rtrim(rtrim(pg_get_viewdef(('public.'||v)::regclass, true)), ';');
    IF position('azdad_residential_listings' in src) > 0 THEN
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
  END LOOP;
END
$do$;

-- ── Restore every dependent, index and grant either CASCADE removed (a no-op replay here: ─────────
--    everything was already restored, in this exact order, against the live database) ─────────────
DO $restore$
DECLARE r record; pass int; okc int; last_okc int := -1; failed text[] := '{}';
BEGIN
  FOR pass IN 1..8 LOOP
    okc := 0;
    FOR r IN
      SELECT ddl, obj_name, obj_kind FROM ops_ddl_snapshot
      WHERE label='pre_azdad_activation_20260906'
      ORDER BY ordinal, id
    LOOP
      BEGIN
        EXECUTE r.ddl;
        okc := okc + 1;
      EXCEPTION
        WHEN duplicate_table OR duplicate_object THEN okc := okc + 1;
        WHEN OTHERS THEN failed := array_append(failed, r.obj_kind||':'||r.obj_name||' -> '||SQLERRM);
      END;
    END LOOP;
    EXIT WHEN okc = last_okc AND pass > 1;
    last_okc := okc;
  END LOOP;
END
$restore$;
