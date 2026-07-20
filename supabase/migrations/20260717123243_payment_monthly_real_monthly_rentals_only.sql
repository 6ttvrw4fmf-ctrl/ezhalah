-- Recovered verbatim from production on 2026-07-20 (drift reconciliation): applied directly to prod via MCP as supabase_migrations.schema_migrations version 20260717123243, name 'payment_monthly_real_monthly_rentals_only'; this committed file is the source-of-truth record, NOT the apply path. Body is byte-for-byte the live statement (md5 1ca437e9b066bb0f679244d4ed5b883f).

-- OWNER DECISION (2026-07-17, supersedes the 2026-07-16 payment-schedule definition):
-- Monthly = a REAL MONTHLY RENTAL — i.e. the SOURCE itself states a monthly rental product.
-- Yearly  = everything else.
--
-- What changed and why: the 2026-07-16 rule counted aqar's rent-now-pay-later (RNPL) listings as
-- Monthly, because the tenant *can* pay monthly. On review the owner ruled that RNPL is INSTALLMENT
-- FINANCING layered on an ANNUAL lease — not a monthly rental — so those 15,419 listings belong in
-- Yearly. Monthly now means what a user actually expects: short-term/monthly rental products.
--
-- The owner's first instruction was "Monthly = Gathern only". That was refined after this was surfaced:
-- taken literally it would ALSO have pushed 1,693 listings whose SOURCE explicitly says «شهري» into
-- Yearly — aqarmonthly (1,430; a monthly-rental platform, same product as Gathern) plus 263 genuine
-- monthly leases on aqarcity/mustqr/eaqartabuk/satel. Filing those under Yearly would assert something
-- the source contradicts (aggregator-fidelity rule) and would hide 1,430 real monthly rentals from the
-- Monthly filter. Owner chose: Monthly = real monthly rentals (Gathern + aqarmonthly + source-stated
-- monthly leases); drop ONLY the RNPL inference.
--
-- Definition now:
--   payment_monthly = rent_period_ar = 'شهري'                       (source states a monthly lease)
--                     OR platform in ('gathern','aqarmonthly')      (monthly-rental platforms; also
--                                                                    covers rows with a NULL period)
--   (the aqar rent_now_pay_later arm is REMOVED)
--
-- Expected: Monthly 22,175 / Yearly 46,630 (production_ready rent). No RPC change needed — the RPC
-- already buckets on payment_monthly, so this single function is the one source of truth.
CREATE OR REPLACE FUNCTION public.sync_payment_monthly()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare n int;
begin
  with want as (
    select s.source_table, s.listing_id,
      coalesce(
        s.deal_ar = 'إيجار'
        and (
             s.rent_period_ar = 'شهري'                    -- source states a monthly lease
          or s.platform in ('gathern','aqarmonthly')      -- monthly-rental platforms (incl. NULL-period rows)
        ), false) as pm
    from search_listings_ar s
  )
  update search_listings_ar s
    set payment_monthly = want.pm
  from want
  where want.source_table = s.source_table and want.listing_id = s.listing_id
    and s.payment_monthly is distinct from want.pm;
  get diagnostics n = row_count;
  return n;
end $$;
