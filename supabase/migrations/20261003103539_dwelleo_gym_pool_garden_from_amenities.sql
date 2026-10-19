-- dwelleo gym / pool / garden reach the Advanced Filter (🆕 New Listings Engineer, 2026-10-03).
--
-- TRAPPED, not absent: dwelleo publishes a structured amenity list (additional_info.amenities,
-- written by scrapers/dwelleo/run.py from the record's own amenities array) that names
-- «صالة رياضية» / «حمام سباحة» / «حديقة» on 516 / 486 / 922 active rows, yet both dwelleo arms of
-- listing_rich_attrs hard-coded NULL::boolean AS pool / gym / garden, so every one of them answered
-- "unknown" to the gym / pool / garden amenity tokens the owner wired on 2026-08-31
-- (src/lib/afCohorts.ts RESIDENTIAL_AMENITY_BASE). Measured on tonight's 954 new dwelleo rows:
-- 26 gym, 34 pool, 52 garden published, 0 reached search.
--
-- A positive-only list: named → true; not named → NULL (unknown), NEVER false. A list that omits a
-- gym does not say there is no gym (ADVANCED_FILTER_SOURCE_TRUTH.md §2).
--
-- Needle edit on the LIVE body (read at apply time, the batch5-7 pattern): only the three NULL lines
-- inside the two dwelleo arms change; every other arm is byte-identical. The hourly job 28
-- (sync_all_rich_attrs) carries the values into search_listings_ar — nothing is hand-run.
-- UNDO: the same DO block with the replacement reversed (the CASE lines back to NULL::boolean AS …).
set local statement_timeout = '5min';
-- Fail fast on ANY lock wait, not only inside the retry loop: a queued ACCESS EXCLUSIVE request
-- stalls every reader of the view behind it (first attempt waited 60s+ behind the detector sweep).
set local lock_timeout = '3s';
DO $do$
DECLARE v text; new_v text; t text; a int; b int; seg text; i int; ok boolean := false;
BEGIN
  v := pg_get_viewdef('public.listing_rich_attrs'::regclass,true);
  -- Idempotence is judged INSIDE the dwelleo arm: another arm already reads «صالة رياضية» from its
  -- own features_ar list (the same true/NULL shape this applies), so a view-wide search is wrong.
  IF position('صالة رياضية' in substr(v, position('''dwelleo_residential_listings''::text AS source_table' in v),
       position('FROM dwelleo_residential_listings x' in v) - position('''dwelleo_residential_listings''::text AS source_table' in v))) > 0 THEN
    RAISE NOTICE 'listing_rich_attrs dwelleo arms already read gym/pool/garden';
    RETURN;
  END IF;
  FOR i IN 1..20 LOOP
    BEGIN
      SET LOCAL lock_timeout = '3s';
      v := rtrim(rtrim(pg_get_viewdef('public.listing_rich_attrs'::regclass,true)),';');
      new_v := v;
      FOREACH t IN ARRAY ARRAY['dwelleo_residential_listings','dwelleo_commercial_listings'] LOOP
        a := position(format('%L::text AS source_table', t) in new_v);
        b := position(format('FROM %s x', t) in new_v);
        IF a = 0 OR b = 0 OR b < a THEN
          RAISE EXCEPTION 'dwelleo arm % not found in listing_rich_attrs', t;
        END IF;
        seg := substr(new_v, a, b - a);
        IF (length(seg) - length(replace(seg, 'NULL::boolean AS pool,', ''))) <> length('NULL::boolean AS pool,')
           OR (length(seg) - length(replace(seg, 'NULL::boolean AS gym,', ''))) <> length('NULL::boolean AS gym,')
           OR (length(seg) - length(replace(seg, 'NULL::boolean AS garden,', ''))) <> length('NULL::boolean AS garden,') THEN
          RAISE EXCEPTION 'arm % does not carry exactly one NULL pool/gym/garden line each', t;
        END IF;
        seg := replace(seg, 'NULL::boolean AS pool,',
          $r$CASE WHEN x.additional_info -> 'amenities' ? 'حمام سباحة' THEN true ELSE NULL::boolean END AS pool,$r$);
        seg := replace(seg, 'NULL::boolean AS gym,',
          $r$CASE WHEN x.additional_info -> 'amenities' ? 'صالة رياضية' THEN true ELSE NULL::boolean END AS gym,$r$);
        seg := replace(seg, 'NULL::boolean AS garden,',
          $r$CASE WHEN x.additional_info -> 'amenities' ? 'حديقة' THEN true ELSE NULL::boolean END AS garden,$r$);
        new_v := substr(new_v, 1, a - 1) || seg || substr(new_v, b);
      END LOOP;
      EXECUTE 'CREATE OR REPLACE VIEW public.listing_rich_attrs AS ' || new_v;
      EXECUTE 'GRANT ALL ON public.listing_rich_attrs TO postgres, anon, authenticated, service_role';
      ok := true;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      PERFORM pg_sleep(2);
    END;
  END LOOP;
  IF NOT ok THEN
    RAISE EXCEPTION 'could not acquire ACCESS EXCLUSIVE on listing_rich_attrs after 20 short attempts - retry later';
  END IF;
  RAISE NOTICE 'listing_rich_attrs dwelleo arms now read gym/pool/garden (attempt %)', i;
END
$do$;

DO $verify$
DECLARE v text := pg_get_viewdef('public.listing_rich_attrs'::regclass,true); t text; seg text; n_true int; n_false int;
BEGIN
  FOREACH t IN ARRAY ARRAY['dwelleo_residential_listings','dwelleo_commercial_listings'] LOOP
    seg := substr(v, position(format('%L::text AS source_table', t) in v),
                  position(format('FROM %s x', t) in v) - position(format('%L::text AS source_table', t) in v));
    IF position('صالة رياضية' in seg) = 0 OR position('حمام سباحة' in seg) = 0 OR position('حديقة' in seg) = 0 THEN
      RAISE EXCEPTION 'arm % does not read gym/pool/garden from its amenities', t;
    END IF;
  END LOOP;
  SELECT count(*) FILTER (WHERE gym), count(*) FILTER (WHERE gym = false) INTO n_true, n_false
    FROM public.listing_rich_attrs WHERE source_table = 'dwelleo_residential_listings';
  IF n_true = 0 THEN RAISE EXCEPTION 'dwelleo gym still never true'; END IF;
  IF n_false <> 0 THEN RAISE EXCEPTION 'dwelleo gym produced false (unknown must stay NULL)'; END IF;
END
$verify$;
