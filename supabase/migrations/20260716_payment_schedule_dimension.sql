-- Owner PERMANENT rule (2026-07-16): the Monthly/Yearly rental filter must represent HOW THE TENANT
-- PAYS (payment schedule), NOT how long the lease lasts. Lease length and payment schedule are now
-- SEPARATE dimensions in the architecture.
--   Monthly = the source EXPLICITLY offers a monthly payment option (aqar rent-now-pay-later, gathern,
--             aqarmonthly, and genuine monthly leases).
--   Yearly  = the tenant must pay annually.
--
-- ROOT CAUSE: rent_period_ar was derived only from source rent_period (LEASE length), so 15,174 aqar
-- listings that offer monthly installment payment (rent_now_pay_later=true) were reachable only under
-- Yearly. rent_period_ar (lease length) is LEFT UNCHANGED (honest source data, still used for card
-- price display); a NEW, independent payment_monthly column carries the payment-schedule signal that the
-- Monthly/Yearly filter now uses. Fixed at the architecture layer, not with UI special-casing.
--
-- Applied to production 2026-07-16. Backfill: Monthly 37,540 / Yearly 31,540 (15,174 aqar RNPL moved to
-- Monthly). Verified via the live anon endpoint: an aqar RNPL listing now appears under Monthly and is
-- absent from Yearly; Riyadh rent partitions exactly (28,917 = 12,586 Monthly + 16,331 Yearly, no overlap
-- / gap). DB-only change (no frontend/Vercel deploy).

-- 1) The new, separate payment-schedule dimension.
ALTER TABLE public.search_listings_ar
  ADD COLUMN IF NOT EXISTS payment_monthly boolean NOT NULL DEFAULT false;

-- 2) Dedicated, idempotent, recurring resolver for the payment-schedule signal (isolated from the big
--    active_listing_ids_v2 matview / sync — one place, like resolve_aqar_locations / resolve_dealapp_districts).
CREATE OR REPLACE FUNCTION public.sync_payment_monthly()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare n int;
begin
  with want as (
    select s.source_table, s.listing_id,
      coalesce(
        s.deal_ar = 'إيجار'
        and (
             s.rent_period_ar = 'شهري'                         -- genuine monthly lease (incl gathern/aqarmonthly)
          or s.platform in ('gathern','aqarmonthly')           -- inherent monthly-payment platforms
          or (s.platform = 'aqar' and (                        -- aqar's real per-listing RNPL installment product
                exists (select 1 from aqar_residential_listings a where a.id=s.listing_id and s.source_table='aqar_residential_listings' and a.rent_now_pay_later is true)
             or exists (select 1 from aqar_commercial_listings a  where a.id=s.listing_id and s.source_table='aqar_commercial_listings'  and a.rent_now_pay_later is true)
             ))
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

-- 3) Schedule it every 10 min (offset +5, after the search-index sync at :15) so new rows get their
--    payment-schedule signal promptly. Guarded so a repeat apply is a no-op.
do $do$
begin
  if not exists (select 1 from cron.job where jobname='sync-payment-monthly') then
    perform cron.schedule('sync-payment-monthly', '5-59/10 * * * *', 'select public.sync_payment_monthly();');
  end if;
end $do$;

-- 4) RPC: the Monthly/Yearly predicate now buckets on payment_monthly (payment schedule), not lease
--    length. See migration rpc_rent_period_uses_payment_monthly for the full function body applied to
--    production (only the rent-period clause changed vs the prior definition):
--       Monthly ('شهري') = s.payment_monthly = true
--       Yearly  ('سنوي') = s.payment_monthly = false
--    (The full CREATE OR REPLACE of location_search_candidates_ar was applied directly; it is not repeated
--     here to avoid drift with concurrent RPC edits — the authoritative body lives in the DB migration
--     history. This file documents the payment-schedule dimension + resolver + schedule.)
