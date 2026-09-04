-- Close the last AF attribute-coverage gap in the fleet (2026-09-03).
--
-- After wiring the five newly activated platforms, a coverage sweep over every source_table present
-- in search_listings_ar found exactly one platform still missing an arm: muktamel is in
-- listing_extra_attrs but NOT in listing_rich_attrs, so its 260 searchable rows (237 residential +
-- 23 commercial) could never contribute a rich attribute — installments, meters, balcony, laundry,
-- majlis, coordinates, postal code.
--
-- muktamel's SCRAPER is paused (it never completed a full crawl and burns hours of CI), but its
-- historical rows are active and searchable, so the AF surface should treat them like every other
-- searchable row. This is exactly the asymmetry mon_detect_af_coverage_cliff exists to notice.
--
-- Same method as the five: the arm is CLONED FROM THE LIVE october arm, which shares muktamel's
-- aqar-derived column shape, so every mapping convention comes from the shipped text rather than
-- from a hand-written guess. Plain view + additive UNION ALL = CREATE OR REPLACE in place, no
-- CASCADE. Columns muktamel does not populate stay NULL, never false.
DO $do$
DECLARE
  src text; arm text; arms text := ''; st int; en int; t text;
BEGIN
  src := rtrim(rtrim(pg_get_viewdef('public.listing_rich_attrs'::regclass, true)), ';');

  IF position('muktamel_residential_listings' in src) > 0 THEN
    RAISE NOTICE 'listing_rich_attrs already covers muktamel — no-op';
    RETURN;
  END IF;

  st := position('SELECT ''october_residential_listings''::text AS source_table' in src);
  IF st = 0 THEN
    RAISE EXCEPTION 'no october arm to clone in listing_rich_attrs — shape changed, refusing to guess';
  END IF;
  en := st + position('FROM october_residential_listings x' in substring(src from st)) - 1;
  en := en + position('WHERE x.active' in substring(src from en)) - 1 + length('WHERE x.active');
  arm := substring(src from st for en - st);

  FOREACH t IN ARRAY ARRAY['muktamel_residential_listings','muktamel_commercial_listings'] LOOP
    arms := arms || E'\nUNION ALL\n ' || replace(arm, 'october_residential_listings', t);
  END LOOP;

  EXECUTE 'CREATE OR REPLACE VIEW public.listing_rich_attrs AS ' || src || arms;
END
$do$;

-- Coverage assertion: after this, NO searchable platform may be missing from either view.
DO $do$
DECLARE missing text;
BEGIN
  select string_agg(s.source_table, ', ') into missing
  from (select distinct source_table from search_listings_ar) s
  where s.source_table not in (select distinct source_table from listing_extra_attrs)
     or s.source_table not in (select distinct source_table from listing_rich_attrs);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'still uncovered by the AF attribute views: %', missing;
  END IF;
END
$do$;

select (select count(*) from listing_rich_attrs where source_table like 'muktamel%') muktamel_rich_rows,
       (select count(distinct source_table) from search_listings_ar) searchable_tables,
       (select count(distinct source_table) from listing_extra_attrs) extra_tables,
       (select count(distinct source_table) from listing_rich_attrs) rich_tables;
