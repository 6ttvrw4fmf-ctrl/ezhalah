-- Mirror of applied migrations 20260809114927 / 114950 / 115037 (final body; the DB is authoritative).
-- Squashed: the first two were superseded within minutes by first-run calibration, and a mirror
-- should show what production actually runs.
--
-- MONITORING for the owner's permanent SOURCE IS TRUTH rule (2026-08-09). The scraper-side guards
-- are build-failing tests (scrapers/common/tests/test_source_is_truth_fleet_invariants.py); this is
-- the production-side counterpart, so a violation that slips past them — a new platform, a DB
-- trigger, a manual write — is still visible in the data.
--
-- Every row is a QUESTION, not a verdict. The fidelity rule forbids repairing on a statistical
-- signal alone: confirm against the source page first, exactly as the 2026-08-09 aqar repair did
-- (8/8 verified live before 352 rows were written).
--
-- CALIBRATION (why one check is absent and one is not a violation):
--   • `price_total = price_per_meter * area_m2` was DROPPED after its first run returned 8,197 aqar
--     + 1,389 dealapp rows. It measures the wrong thing: when a platform publishes BOTH a total and
--     a rate the two are consistent by construction, so an exact product marks a WELL-FORMED
--     listing, not our arithmetic. The real defect — OUR pipeline deriving a total — is a property
--     of the code and is blocked at build time. A monitor buried under 9.6k false positives is
--     worse than no monitor.
--   • `trend_active_listing_with_no_price` is a TREND metric: aqar alone has ~7k legitimately
--     price-less rows («طلب تسويق», where aqar shows the human no figure and we correctly store
--     none). Investigate a RISE — that is what a degraded fetch blanking verified rows looks like.
create or replace function public.mon_source_is_truth_violations()
returns table(check_name text, platform text, n bigint, detail text)
language sql
stable
as $function$
  -- VIOLATION: a priced rent row with no period is unreachable by both the annual and the monthly
  -- filter. This is the shape that let aqar file enum-2 monthly listings as yearly.
  select 'rent_period_missing_on_priced_rent'::text, s.platform, count(*)::bigint,
         'priced rent listings with NO period — unreachable by both annual and monthly filters'::text
  from public.search_listings_ar s
  where s.deal_ar = 'إيجار' and s.price_annual is not null and s.rent_period_ar is null
  group by s.platform having count(*) > 0

  union all
  -- VIOLATION: a Buy total identical to its own per-metre rate is a RATE stored as a total.
  select 'buy_total_equals_per_metre_rate', s.platform, count(*)::bigint,
         'price_total == price_per_meter — a RATE stored as the whole asking price'
  from public.search_listings_ar s
  where s.deal_ar = 'بيع' and s.price_total is not null and s.price_per_meter is not null
    and s.price_total = s.price_per_meter and s.price_total > 0
  group by s.platform having count(*) > 0

  union all
  -- VIOLATION: a hard FALSE across a platform's ENTIRE inventory is a DEFAULT, not a reading. A
  -- platform that really publishes the field yields a mix of true/false/null.
  select 'amenity_false_for_whole_platform', t.platform, t.n_false::bigint,
         'furnished=false on 100% of a platform''s rows — a default asserting NO, not a reading'
  from (
    select s.platform,
           count(*) filter (where s.furnished is false) n_false,
           count(*) filter (where s.furnished is true)  n_true,
           count(*) filter (where s.furnished is null)  n_null
    from public.search_listings_ar s group by s.platform
  ) t
  where t.n_false > 50 and t.n_true = 0 and t.n_null = 0

  union all
  -- TREND (not a violation): watch for a RISE. A degraded fetch blanking verified rows shows up
  -- here first. A high steady baseline is legitimate — aqar publishes «طلب تسويق» instead of a
  -- price on thousands of live ads and we correctly store nothing.
  select 'trend_active_listing_with_no_price', s.platform, count(*)::bigint,
         'TREND baseline — investigate a rise, not the absolute number'
  from public.search_listings_ar s
  where s.price_annual is null and s.price_total is null
  group by s.platform having count(*) > 0
$function$;
