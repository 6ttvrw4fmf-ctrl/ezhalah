-- OWNER PRODUCT DECISION (2026-08-18), implemented at the canonical classification layer.
--
--   Confirmed rent + monthly evidence  -> شهري
--   Confirmed rent + no monthly evidence -> سنوي   (including price 0 / missing / السعر عند الطلب)
--   An explicit source period always beats the fallback.
--   NEVER applies to a sale listing.
--   Never infer monthly just because the number looks small.
--
-- WHERE THIS LIVES, AND WHY IT MATTERS.
-- The fallback is applied in sync_search_listings_ar, which is the ONLY writer of
-- search_listings_ar.rent_period_ar - the canonical period field every read surface already
-- consumes (verified: location_search_candidates_ar, af_eligibility_clause, af_eligible_count,
-- af_in_certified_cohort, apartment_guided_counts_ar, district_options_ar,
-- property_age_option_counts_ar, mon_detect_trending_cohort_drift, mon_af_new_listing_readiness).
-- So Normal Filter, Advanced Filter, the AI/backend search, city counts, district counts, Trending
-- counts, totals, types, price, area, bedrooms and pagination all inherit it from one place, and no
-- listing gets special search behaviour.
--
-- The raw scraper tables are deliberately NOT touched. Writing سنوي into <platform>_*_listings
-- would fabricate a source value, destroy the honest NULL that the run #29 live probes just proved
-- correct (37/38 HTTP 200 showing the source publishes no period), and break the §22.1 protections.
-- Source truth stays NULL; the PRODUCT fallback is a classification, applied where classification
-- belongs.
--
-- SALE LISTINGS ARE PROTECTED BY CONSTRUCTION. The fallback sits INSIDE the existing
-- `case when lower(v.transaction_type)='rent' then ... end`, so a sale row can never reach it and
-- still yields NULL. That is not incidental - it is the structural guarantee, and barrier limb 1
-- asserts it continuously. (14 Buy rows currently carry a stray rent_period='monthly' upstream;
-- they have no rent_period_ar today and still get none.)
--
-- ONE EDGE THE RULE DOES NOT NAME, DECIDED AGAINST THE DEFAULT.
-- gathern and aqarmonthly are MONTHLY-ONLY sources - every listing is a monthly rental, an owner
-- rule from 2026-07-06 that the app already relies on (MONTHLY_ONLY_TABLE in src/data/remote.ts)
-- and that the search RPC's own monthly branch is built around. For those two platforms the
-- platform convention IS monthly evidence, so a period-less row there falls back to شهري, not سنوي.
-- Today this changes nothing (both are 100% شهري: gathern 29,030, aqarmonthly 1,679, zero NULL),
-- but defaulting a future period-less gathern row to annual would understate its rent 12x - the
-- exact defect fought on souq24 and on aqar's retired rent_period='annual' default.
--
-- MEASURED IMPACT, quantified BEFORE the change:
--   605 rent listings move NULL -> سنوي   (309 price-on-request / priceless, 296 priced, 0 zero-price)
--     aqar 217, raghdan 128, eaqartabuk 111, dealapp 46, eastabha 30, alkhaas 23, mustqr 10,
--     sadin 9, souq24 8, mizlaj 7, hajer 6, ramzalqasim 3, aldarim 3, abeea 2, jurash 1, alhoshan 1
--   0 listings move to شهري · 31,674 explicit شهري unchanged · 46,417 explicit سنوي unchanged
--   116,952 sale listings unchanged (rent_period_ar stays NULL)
-- From the user side the defect was already visible: the «كلاهما» chip returned 71,459 against
-- 71,939 for no-period-chip in the Residential scope - a 480-listing gap that is exactly this cohort.

do $$
declare
  src text; newsrc text; n int;
  anchor constant text :=
    'case v.rent_period when ''monthly'' then ''شهري'' when ''annual'' then ''سنوي'' else null end';
  replacement constant text :=
    'case v.rent_period when ''monthly'' then ''شهري'' when ''annual'' then ''سنوي'' '
    || 'else case when v.platform in (''gathern'',''aqarmonthly'') then ''شهري'' else ''سنوي'' end end';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace nsp on nsp.oid = p.pronamespace
  where nsp.nspname = 'public' and p.proname = 'sync_search_listings_ar';
  if src is null then raise exception 'sync_search_listings_ar not found'; end if;

  if position('gathern'',''aqarmonthly' in src) > 0 then
    raise notice 'fallback already installed - no-op'; return;
  end if;

  -- The expression appears exactly twice: once in the INSERT select list, once in the
  -- change-detection WHERE clause. BOTH must change or existing rows never re-upsert.
  n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  if n <> 2 then
    raise exception 'period expression appears % times, expected exactly 2 - refusing to splice', n;
  end if;

  newsrc := replace(src, anchor, replacement);
  if (length(newsrc) - length(replace(newsrc, replacement, ''))) / length(replacement) <> 2 then
    raise exception 'splice did not produce exactly 2 replacements - refusing';
  end if;
  if length(newsrc) - length(src) <> 2 * (length(replacement) - length(anchor)) then
    raise exception 'splice changed more than the two anchors - refusing';
  end if;

  execute newsrc;
end $$;
