-- OWNER DECISION (2026-07-17) — supersedes the 2026-07-16 payment-schedule definition.
--
--   Monthly = a REAL MONTHLY RENTAL (the SOURCE itself states a monthly rental product)
--   Yearly  = everything else
--
-- WHY IT CHANGED: the 2026-07-16 rule counted aqar's rent-now-pay-later (RNPL) listings as Monthly on
-- the reasoning that the tenant *can* pay monthly. On review the owner ruled RNPL is INSTALLMENT
-- FINANCING layered on an ANNUAL lease — not a monthly rental — so those 15,419 listings belong in
-- Yearly. Monthly now means what a user expects: short-term / monthly rental products.
--
-- SCOPE REFINEMENT: the owner's first instruction was "Monthly = Gathern only". Taken literally that
-- would ALSO have pushed 1,693 listings whose SOURCE explicitly says «شهري» into Yearly — aqarmonthly
-- (1,430; a monthly-rental platform, same product as Gathern) plus 263 genuine monthly leases on
-- aqarcity / mustqr / eaqartabuk / satel. Filing those under Yearly would assert something the source
-- contradicts (aggregator-fidelity rule) and would hide 1,430 real monthly rentals from the Monthly
-- filter. Surfaced to the owner, who chose: Monthly = real monthly rentals; drop ONLY the RNPL inference.
--
-- RESULT (production_ready rent): Monthly 22,175 / Yearly 46,630.
--   Monthly = gathern 20,482 + aqarmonthly 1,430 + 263 source-stated monthly leases.
--   Yearly  = 15,419 aqar RNPL (moved back) + 31,211 genuinely annual.
-- Verified via the live anon endpoint (Riyadh rent): Monthly 5,305 = gathern 4,177 + aqarmonthly 802 +
-- aqarcity 12 + satel 4 + aqar 5 (those 5 are genuine source-monthly, not RNPL); Yearly 23,576.
--
-- No RPC change was needed for the search path — it already buckets on payment_monthly, which is the
-- single source of truth. Only this one function's definition changes.

-- 1) The payment_monthly definition — drop the aqar RNPL arm.
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

-- 2) Make the Property-Age COUNTS RPC read the same single column as the search RPC, so the two can
--    never drift. Before this, counts still carried the pre-payment_monthly clause: the MONTHLY arms
--    happened to agree, but the YEARLY arms did not — counts required rent_period_ar='سنوي', silently
--    EXCLUDING NULL-period rows that search counts as Yearly (measured: search 46,630 vs counts 46,323,
--    a 307-row divergence). Duplicated logic is exactly what produced the earlier 58% monthly undercount.
--
--    METHOD: targeted string replacement of ONLY the rent-period clause on the CURRENT live body — NOT a
--    hand-copied full body. Copying a stale body is what silently reverted the rent-period fix once
--    already (PR#120). This cannot drop an unrelated clause, and RAISES if the expected clause is absent
--    instead of silently no-op'ing. Idempotent: re-running finds no old clause and raises, so it is
--    guarded by the IF below.
DO $mig$
DECLARE
  d text;
  old_clause text := 'and (p_rent_period is null
           or (p_rent_period = ''شهري''
               and (s.rent_period_ar = ''شهري'' or s.platform in (''gathern'',''aqarmonthly'')))
           or (p_rent_period = ''سنوي''
               and s.rent_period_ar = ''سنوي''
               and (s.platform is null or s.platform not in (''gathern'',''aqarmonthly'')))
           or (p_rent_period not in (''شهري'',''سنوي'') and s.rent_period_ar = p_rent_period))';
  new_clause text := 'and (p_rent_period is null
           or (p_rent_period = ''شهري'' and s.payment_monthly = true)
           or (p_rent_period = ''سنوي'' and s.payment_monthly = false)
           or (p_rent_period not in (''شهري'',''سنوي'') and s.rent_period_ar = p_rent_period))';
BEGIN
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE proname = 'property_age_option_counts_ar';
  IF d IS NULL THEN
    RAISE EXCEPTION 'property_age_option_counts_ar not found';
  END IF;
  IF position('payment_monthly' in d) > 0 THEN
    RAISE NOTICE 'counts RPC already reads payment_monthly — nothing to do';
  ELSIF position(old_clause in d) = 0 THEN
    RAISE EXCEPTION 'expected rent-period clause not found in property_age_option_counts_ar — refusing to guess (body changed?)';
  ELSE
    d := replace(d, old_clause, new_clause);
    EXECUTE d;
  END IF;
END
$mig$;

NOTIFY pgrst, 'reload schema';

-- Verified after apply (live anon endpoint, Riyadh rent): counts↔search agree EXACTLY on both periods —
--   شهري: counts 5,305 = search 5,305   |   سنوي: counts 23,576 = search 23,576
