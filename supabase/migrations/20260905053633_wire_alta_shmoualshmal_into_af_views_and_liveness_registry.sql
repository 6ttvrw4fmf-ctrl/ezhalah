-- Give alta + shmoualshmal the SAME Advanced Filter attribute coverage every other platform has,
-- and register their liveness policy — the two halves of a launch that are easy to forget because
-- neither shows up as a missing row in search (owner-instructed 2026-09-05).
--
-- WHY BOTH HALVES MATTER.
--   · listing_extra_attrs / listing_rich_attrs are what sync_all_rich_attrs reads to populate the
--     AF columns of search_listings_ar. A platform with no arm here is searchable but INVISIBLE to
--     the Advanced Filter — its already-captured attributes simply never arrive.
--   · ops_liveness_registry is what the staleness monitor grades rows against. A production-
--     searchable platform missing from it is a live row that nothing grades, which is exactly the
--     blind spot that registry exists to remove (scripts/verify-liveness-contract.ts fails closed
--     on it, and did fail on these two until this migration).
--
-- HOW THE ARMS ARE BUILT: cloned from the LIVE october arm, never hand-written — the same method
-- the 2026-09-03 five-platform wiring used (20260903182553). october is an exact aqar-shaped clone
-- and these two tables share that shape, so its arm already encodes every convention that matters
-- (canon_direction_ar on direction, rent_now_pay_later -> installment_available/amount,
-- balcony_terrace -> balcony, reception_rooms_majlis -> majlis_rooms, and the additional_info
-- latitude/longitude extraction). Generating from the live text means this cannot drift.
--
-- SOURCE IS TRUTH is unchanged. Every column these two sources do not publish stays NULL — which
-- for shmoualshmal is EVERY price column, because the site publishes no price at all. A NULL AF
-- attribute is excluded from a strict AF predicate rather than being read as false.
--
-- CREATE OR REPLACE VIEW is safe here: both objects are plain views, and appending UNION ALL arms
-- leaves the column list untouched, so it applies in place with no DROP, no CASCADE and no
-- dependent rebuild.
DO $do$
DECLARE
  v text; src text; arm text; arms text; st int; en int; t text;
  tbls text[] := ARRAY[
    'alta_residential_listings','alta_commercial_listings',
    'shmoualshmal_residential_listings','shmoualshmal_commercial_listings'];
BEGIN
  FOREACH v IN ARRAY ARRAY['listing_extra_attrs','listing_rich_attrs'] LOOP
    src := rtrim(rtrim(pg_get_viewdef(('public.'||v)::regclass, true)), ';');

    IF position('alta_residential_listings' in src) > 0 THEN
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

-- CRAWL_PRESENCE_ONLY / 168h / grace 3 — the honest tier for a small WordPress REST catalogue that
-- is re-read in full each run and has no per-listing revisit endpoint. Mirrors
-- sql/mirrors/liveness_registry.json, which verify-liveness-registry-mirror.ts holds to equality.
INSERT INTO public.ops_liveness_registry (platform, strategy, sla_hours, grace) VALUES
  ('alta','CRAWL_PRESENCE_ONLY',168,3),
  ('shmoualshmal','CRAWL_PRESENCE_ONLY',168,3)
ON CONFLICT (platform) DO UPDATE SET strategy=excluded.strategy,
  sla_hours=excluded.sla_hours, grace=excluded.grace;

-- Fail closed: no platform may contribute searchable rows without a registered liveness policy.
DO $$
DECLARE v_gap text[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT split_part(s.source_table,'_',1)), '{}') INTO v_gap
    FROM public.search_listings_ar s
   WHERE s.production_ready
     AND NOT EXISTS (SELECT 1 FROM public.ops_liveness_registry r
                      WHERE r.platform = split_part(s.source_table,'_',1));
  IF cardinality(v_gap) > 0 THEN
    RAISE EXCEPTION 'searchable but unregistered: %', v_gap;
  END IF;
END $$;
