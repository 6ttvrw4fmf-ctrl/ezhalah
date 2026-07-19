-- Fix (P1, full-filter-QA-sweep 2026-07-19): a narrow but real hole in the payment_monthly rule
-- from PR#132. That rule already correctly excludes aqar's rent-now-pay-later (RNPL) listings from
-- Monthly (owner ruling 2026-07-17: RNPL is installment FINANCING on an ANNUAL lease, not a real
-- monthly rental) — via NOT referencing rent_now_pay_later at all in the OR, since RNPL rows are
-- expected to carry rent_period='annual' from the source.
--
-- But 16 aqar_residential_listings rows (0 in aqar_commercial_listings; verified system-wide across
-- every platform table with both columns — aqar_residential is the ONLY affected table) have BOTH
-- rent_period='monthly' (the raw, source-scraped lease-length field) AND rent_now_pay_later=true
-- simultaneously — a contradiction. Example: id=250817, rent_now_pay_later_monthly=4013,
-- price_annual=48156 (=4013*12, a computed/derived figure, not an independently-sourced annual
-- price) — i.e. this is really the SAME RNPL-on-an-annual-lease product PR#132 already excludes,
-- just with the raw rent_period field ALSO (incorrectly, at the aqar source/scraper layer) tagged
-- monthly. Because sync_payment_monthly()'s first OR-arm only checks rent_period_ar='شهري', these
-- 16 rows slip through payment_monthly=true, appear in Monthly-rent searches, and their price_annual
-- (the BNPL-derived annual figure) gets compared against the user's MONTHLY price bounds ×12 in
-- location_search_candidates_ar — a low-looking "shown monthly price" that's really a mid-range
-- annual lease.
--
-- rent_period_ar itself (lease-length, used for CARD DISPLAY) is deliberately left untouched per the
-- 2026-07-16 investigation's own rule ("rent_period_ar unchanged for card display") — this migration
-- only tightens the derived, search-only payment_monthly classification.
--
-- Built from the CURRENT LIVE body via pg_get_functiondef (never a hand-copied prior migration —
-- see feedback_rpc-full-body-replace-revert-hazard). Only the first OR-arm gained a
-- "not coalesce(a.rent_now_pay_later, false)" guard, sourced via a LEFT JOIN scoped to exactly the
-- two tables that own this signal (aqar_residential_listings / aqar_commercial_listings — the join
-- is a no-op, NULL-coalescing to false, for every other platform). The second OR-arm
-- (platform IN ('gathern','aqarmonthly')) is untouched: verified system-wide that neither platform
-- has this contradiction (rent_now_pay_later is false/absent there), so it needs no guard.

begin;

create or replace function public.sync_payment_monthly()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int;
begin
  with want as (
    select s.source_table, s.listing_id,
      coalesce(
        s.deal_ar = 'إيجار'
        and (
             (s.rent_period_ar = 'شهري'                     -- source states a monthly lease
                and not coalesce(a.rent_now_pay_later, false))  -- ...and it is NOT actually RNPL financing on an annual lease (16-row aqar contradiction, 2026-07-19 fix)
          or s.platform in ('gathern','aqarmonthly')       -- monthly-rental platforms (incl. NULL-period rows)
        ), false) as pm
    from search_listings_ar s
    left join aqar_residential_listings a
      on s.source_table = 'aqar_residential_listings' and a.id = s.listing_id
    left join aqar_commercial_listings ac
      on s.source_table = 'aqar_commercial_listings' and ac.id = s.listing_id
  )
  update search_listings_ar s
    set payment_monthly = want.pm
  from want
  where want.source_table = s.source_table and want.listing_id = s.listing_id
    and s.payment_monthly is distinct from want.pm;
  get diagnostics n = row_count;
  return n;
end $function$;

commit;
