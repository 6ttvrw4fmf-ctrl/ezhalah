-- Owner PERMANENT rule 2026-08-09: THE RENTAL PERIOD COMES ONLY FROM THE SOURCE.
--   source monthly → Monthly · source annual → Annual · annual+instalments/RNPL → ANNUAL
--   daily/weekly only → not Monthly · source silent → Unknown
--   Never calculate or guess the period. Never use the PLATFORM NAME to manufacture it.
--
-- Two defects removed from sync_payment_monthly():
--
-- 1. PLATFORM NAME DECIDED THE PERIOD.  `or s.platform in ('gathern','aqarmonthly')` made every row
--    from those two platforms Monthly regardless of what the source said. Today it is redundant —
--    all 31,373 of their rows already carry rent_period_ar='شهري' recorded from the source — but it
--    is a live trap: the day a scraper run fails to record a period, this clause FABRICATES one.
--    payment_monthly must be a pure function of the row's OWN recorded period.
--
-- 2. THE RNPL EXCLUSION ONLY COVERED AQAR RESIDENTIAL.  "Annual rent payable in monthly
--    instalments" (rent-now-pay-later) is an ANNUAL contract and must never enter Monthly — on ANY
--    platform. The old body joined aqar_residential_listings for the flag (and joined
--    aqar_commercial_listings but never actually read it, so even aqar's own commercial RNPL row
--    was unguarded). alhoshan also publishes RNPL and was covered only by accident.
--    search_listings_ar carries the row's own rent_now_pay_later and is faithful to the raw tables
--    (verified 2026-08-09: 3 mismatches in 115,482 rows = 0.003%), so read it directly — every
--    platform, residential and commercial, one predicate, no joins.
--
-- BEHAVIOUR TODAY: none. Dry-run before applying: 0 rows change (0 enter Monthly, 0 leave).
-- This is preventive hardening — it removes two ways the period could be manufactured in future.
CREATE OR REPLACE FUNCTION public.sync_payment_monthly()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  with want as (
    select s.source_table, s.listing_id,
      coalesce(
            s.deal_ar = 'إيجار'                              -- rentals only
        and s.rent_period_ar = 'شهري'                        -- ONLY the source's own recorded period
        and not coalesce(s.rent_now_pay_later, false)        -- RNPL = ANNUAL, every platform
      , false) as pm
    from search_listings_ar s
  )
  update search_listings_ar s
    set payment_monthly = want.pm
  from want
  where want.source_table = s.source_table and want.listing_id = s.listing_id
    and s.payment_monthly is distinct from want.pm;
  get diagnostics n = row_count;
  return n;
end $function$;
