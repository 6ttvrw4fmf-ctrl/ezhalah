-- Recovered verbatim from production on 2026-07-20 (drift reconciliation): applied directly to prod via MCP as supabase_migrations.schema_migrations version 20260716220836, name 'payment_schedule_dimension_fix_null'; this committed file is the source-of-truth record, NOT the apply path. Body is byte-for-byte the live statement (md5 71beb9e6622c1e0d5adb5131d48982b0).

CREATE OR REPLACE FUNCTION public.sync_payment_monthly()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare n int;
begin
  with want as (
    select s.source_table, s.listing_id,
      coalesce(
        s.deal_ar = 'إيجار'
        and (
             s.rent_period_ar = 'شهري'
          or s.platform in ('gathern','aqarmonthly')
          or (s.platform = 'aqar' and (
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
