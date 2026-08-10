-- CALIBRATION 2026-08-09b, after adversarial review of the 42-row cohort.
--
-- `price_total = price_per_meter` was labelled a VIOLATION meaning "a rate stored as a total". It is
-- not one defect — it is the fingerprint of TWO OPPOSITE ones, and repairing the cohort with a single
-- rule would corrupt roughly half of it:
--   • rate-in-total   (hajer 6, aqargate 13, eastabha 2) — the source publishes only a per-m² rate
--     and it landed in the total column. Fixed at the SCRAPER; the total is honestly UNKNOWN and the
--     card now renders «سعر المتر N ريال/م²».
--   • total-in-rate   (aqar 18, eastabha EA23034) — price_total is a CORRECT total and the RATE
--     column is the contaminated one. On the aqar rows the SOURCE ITSELF prints the total inside its
--     «سعر المتر» slot (ad 6630081: total 600,000 over 600 m², page says rate "600,000"), so those
--     are source-odd-but-correct and must NOT be "repaired" — reading them as rates would price a
--     30,000 m² plot at 390 billion SAR.
-- Renamed to an INVESTIGATE signal so nobody reads the row count as a repair queue. The direction is
-- decided per row by area: an implied rate of 100–20,000 SAR/m² means the total is real.
create or replace function public.mon_source_is_truth_violations()
returns table(check_name text, platform text, n bigint, detail text)
language sql
stable
as $function$
  select 'rent_period_missing_on_priced_rent'::text, s.platform, count(*)::bigint,
         'priced rent listings with NO period — unreachable by both annual and monthly filters'::text
  from public.search_listings_ar s
  where s.deal_ar = 'إيجار' and s.price_annual is not null and s.rent_period_ar is null
  group by s.platform having count(*) > 0

  union all
  select 'investigate_total_equals_per_metre', s.platform, count(*)::bigint,
         'TWO OPPOSITE defects share this shape — decide per row by the implied rate '
         '(price_total/area_m2 in 100..20000 SAR/m² means the TOTAL is real and the RATE column is '
         'the contaminated one). Never repair this cohort with one rule.'
  from public.search_listings_ar s
  where s.deal_ar = 'بيع' and s.price_total is not null and s.price_per_meter is not null
    and s.price_total = s.price_per_meter and s.price_total > 0
  group by s.platform having count(*) > 0

  union all
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
  select 'trend_active_listing_with_no_price', s.platform, count(*)::bigint,
         'TREND baseline — investigate a rise, not the absolute number'
  from public.search_listings_ar s
  where s.price_annual is null and s.price_total is null
  group by s.platform having count(*) > 0
$function$;
