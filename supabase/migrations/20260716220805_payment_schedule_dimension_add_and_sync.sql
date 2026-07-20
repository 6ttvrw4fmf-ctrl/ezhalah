-- Recovered verbatim from production on 2026-07-20 (drift reconciliation): applied directly to prod via MCP as supabase_migrations.schema_migrations version 20260716220805, name 'payment_schedule_dimension_add_and_sync'; this committed file is the source-of-truth record, NOT the apply path. Body is byte-for-byte the live statement (md5 44097f2624f6d7aa6c4643a3558be336).

-- Owner PERMANENT rule (2026-07-16): the Monthly/Yearly filter must represent HOW THE TENANT PAYS
-- (payment schedule), NOT how long the lease lasts. Lease length and payment schedule are now SEPARATE
-- dimensions in the architecture. A listing is Monthly for the filter iff the SOURCE EXPLICITLY offers a
-- monthly payment option; Yearly = the tenant must pay annually.
--
-- Root cause being fixed: rent_period_ar was derived only from source rent_period (LEASE length), so
-- 15,174 aqar listings that offer monthly installment payment (rent_now_pay_later=true) were reachable
-- only under Yearly. rent_period_ar (lease length) is LEFT UNCHANGED (honest source data, used for card
-- display); a NEW, independent payment_monthly column carries the payment-schedule signal that the filter
-- now uses.

-- 1) The new, separate payment-schedule dimension.
ALTER TABLE public.search_listings_ar
  ADD COLUMN IF NOT EXISTS payment_monthly boolean NOT NULL DEFAULT false;

-- 2) Dedicated, idempotent, recurring resolver for the payment-schedule signal (kept OUT of the big
--    active_listing_ids_v2 matview / sync — isolated in one place, exactly like resolve_aqar_locations /
--    resolve_dealapp_districts). payment_monthly = the source EXPLICITLY offers monthly payment:
--      * rent_period_ar='شهري'  — a genuine monthly LEASE (incl. gathern/aqarmonthly, which are monthly
--        products) already means monthly payment;
--      * platform in ('gathern','aqarmonthly') — inherent monthly-payment platforms (belt-and-suspenders);
--      * platform='aqar' AND the aqar source row has rent_now_pay_later=true — aqar's real, per-listing
--        RNPL installment product (the 15,174). Only aqar's flag is a REAL source signal (alhoshan's is
--        scraper-invented, so it is deliberately NOT trusted here — matches "only when the source
--        explicitly offers monthly payment").
--    Everything else = must pay annually = payment_monthly false. Buy rows are always false (irrelevant).
CREATE OR REPLACE FUNCTION public.sync_payment_monthly()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare n int;
begin
  with want as (
    select s.source_table, s.listing_id,
      (s.deal_ar = 'إيجار'
       and (
            s.rent_period_ar = 'شهري'
         or s.platform in ('gathern','aqarmonthly')
         or (s.platform = 'aqar' and (
               exists (select 1 from aqar_residential_listings a where a.id=s.listing_id and s.source_table='aqar_residential_listings' and a.rent_now_pay_later is true)
            or exists (select 1 from aqar_commercial_listings a  where a.id=s.listing_id and s.source_table='aqar_commercial_listings'  and a.rent_now_pay_later is true)
            ))
       )) as pm
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

-- 3) Schedule it every 10 min (offset +5 after the search-index sync at :15/:25/... so new rows get their
--    payment-schedule signal promptly). Guarded so a repeat apply is a no-op.
do $do$
begin
  if not exists (select 1 from cron.job where jobname='sync-payment-monthly') then
    perform cron.schedule('sync-payment-monthly', '5-59/10 * * * *', 'select public.sync_payment_monthly();');
  end if;
end $do$;
