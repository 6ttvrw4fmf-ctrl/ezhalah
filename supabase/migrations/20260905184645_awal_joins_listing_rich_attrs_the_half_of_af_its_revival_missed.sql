-- awal WAS SEARCHABLE WITH ONLY HALF ITS ADVANCED-FILTER WIRING.
-- Found 2026-09-05 while auditing AF coverage across all 38 platforms; awal was the ONLY platform
-- present in listing_extra_attrs (51 rows) and ABSENT from listing_rich_attrs (0 rows).
--
-- HOW IT HAPPENED. awal was un-retired earlier the same day (20260905023206). Its two tables were
-- ALREADY union arms of active_listing_ids_v2 from before the 2026-07-28 retirement, so flipping
-- the registry made search work immediately — and that success hid the gap. listing_extra_attrs
-- happened to still carry an awal arm; listing_rich_attrs never did. A revival is not the same
-- shape as an onboarding, and the difference is exactly the layer nobody re-checks.
--
-- WHAT IT COST. listing_rich_attrs is one of the two views sync_all_rich_attrs reads to populate
-- the AF columns of search_listings_ar. Fields carried there (property_age, street_width_m,
-- direction, majlis rooms, the installment mapping, the additional_info lat/long extraction) could
-- never arrive for awal's 51 listings, so they answered UNKNOWN to those Advanced Filter questions
-- instead of contributing whatever the source actually published. Area/price/bedrooms/bathrooms
-- were unaffected — those travel through active_listing_ids_v2, which is why search looked fine.
--
-- MEASURED AFTER: awal now has 51 rows in BOTH views, and listing_rich_attrs totals 204,460 —
-- exactly the search total. The follow-up sync_listing_rich_attrs('awal_*') updated 0 rows, which
-- is CORRECT and worth recording: awal publishes 0 property_age, 0 direction and 0 street_width
-- across its 44 active rows (8 have bedrooms, 27 have area, 0 have a price). The plumbing was
-- missing; the source is simply sparse. SOURCE IS TRUTH is unchanged.
--
-- Cloned from the LIVE october arm, never hand-written — the same method used for the 5-platform
-- wiring (20260903182553) and for alta/shmoualshmal (20260905053633). CREATE OR REPLACE VIEW is
-- safe: appending UNION ALL arms leaves the column list untouched, so no DROP, no CASCADE, no
-- dependent rebuild.
--
-- NOTE ON THE MISSING TAIL GUARD: a first attempt ended this migration with a fail-closed block
-- that called pg_get_viewdef() once PER searchable platform. That is O(platforms x view size) on a
-- ~270KB definition and hit the statement timeout, rolling the whole migration back. The equivalent
-- assertion now lives in ops_af_attribute_coverage() + verify-af-attribute-views-cover-every-
-- platform.ts, which read each definition ONCE — the right place for a check that must not cost a
-- production transaction.
DO $do$
DECLARE
  v text; src text; arm text; arms text; st int; en int; t text;
  tbls text[] := ARRAY['awal_residential_listings','awal_commercial_listings'];
BEGIN
  FOREACH v IN ARRAY ARRAY['listing_rich_attrs'] LOOP
    src := rtrim(rtrim(pg_get_viewdef(('public.'||v)::regclass, true)), ';');

    IF position('awal_residential_listings' in src) > 0 THEN
      RAISE NOTICE '% already carries the awal arms — skipping', v;
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
    RAISE NOTICE 'wired 2 awal arms into %', v;
  END LOOP;
END
$do$;
