-- Barrier updated to the CORRECTED period semantics (same day).
-- The first version asserted payment_monthly == (rent_period_ar='شهري'), which contradicts the
-- owner's RNPL rule: an RNPL rental states 'شهري' yet is deliberately NOT monthly.
--
-- The invariant that actually matters is REACHABILITY: every rental with a STATED period must be
-- reachable by exactly one bucket, and no rental may be in both.
create or replace function public.mon_filter_parity_barrier()
returns table(check_name text, detail text, n bigint)
language plpgsql
stable
as $function$
declare
  v_res text[]; v_com text[]; v_rpc bigint; v_idx bigint;
begin
  select array_agg(table_name::text) into v_res from information_schema.tables
   where table_schema='public' and table_name like '%\_residential\_listings';
  select array_agg(table_name::text) into v_com from information_schema.tables
   where table_schema='public' and table_name like '%\_commercial\_listings';

  -- 1. REACHABILITY: a stated period must land in exactly one bucket.
  --    annual  = 'سنوي'  OR ('شهري' AND rnpl)      [annual paid in instalments]
  --    monthly = payment_monthly                    ['شهري' AND NOT rnpl]
  return query
  select 'stated_period_reachable_by_neither_bucket'::text,
         'production_ready rentals whose period IS stated but match neither annual nor monthly'::text,
         count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='إيجار' and s.production_ready and s.rent_period_ar is not null
    and not (s.rent_period_ar='سنوي' or (s.rent_period_ar='شهري' and coalesce(s.rent_now_pay_later,false)))
    and not coalesce(s.payment_monthly,false)
  having count(*) > 0;

  -- 2. MUTUAL EXCLUSION.
  return query
  select 'rent_row_in_both_period_buckets'::text,
         'a rental reachable as BOTH annual and monthly'::text, count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='إيجار'
    and (s.rent_period_ar='سنوي' or (s.rent_period_ar='شهري' and coalesce(s.rent_now_pay_later,false)))
    and coalesce(s.payment_monthly,false)
  having count(*) > 0;

  -- 3. RNPL IS NEVER MONTHLY (owner permanent rule).
  return query
  select 'rnpl_listing_marked_monthly'::text,
         'an RNPL/instalment offer classified as a genuine monthly rental'::text, count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='إيجار' and coalesce(s.rent_now_pay_later,false) and coalesce(s.payment_monthly,false)
  having count(*) > 0;

  -- 4. UNKNOWN STAYS UNKNOWN — a period we never read must not be asserted as annual.
  return query
  select 'unknown_period_asserted_as_annual'::text,
         'rentals with NO source period that the annual bucket would still return'::text,
         count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='إيجار' and s.rent_period_ar is null and coalesce(s.payment_monthly,false)
  having count(*) > 0;

  -- 5. COUNT/RESULT PARITY on the live annual-apartment scope.
  select g.cnt_total_base into v_rpc
  from public.apartment_guided_counts_ar(
        p_deal:='إيجار', p_rent_period:='سنوي', p_cities:=array['الرياض'],
        p_tables:=v_res, p_tables2:=v_com, p_types:=array['شقة'], p_types2:=array['شقة'],
        p_category:='Residential') g;
  select count(*) into v_idx
  from public.location_search_candidates_ar(
        p_deal:='إيجار', p_rent_period:='سنوي', p_cities:=array['الرياض'],
        p_tables:=v_res, p_tables2:=v_com, p_types:=array['شقة'], p_types2:=array['شقة'],
        p_category:='Residential', p_limit:=1000000);
  if v_rpc is distinct from v_idx then
    return query select 'count_vs_results_parity'::text,
      format('guided count %s vs results %s for the same scope', v_rpc, v_idx)::text,
      abs(coalesce(v_rpc,0)-coalesce(v_idx,0))::bigint;
  end if;

  -- 6. BUY/RENT SEPARATION.
  return query
  select 'buy_listing_carrying_a_rent_period'::text,
         'a بيع listing carrying a rent period'::text, count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='بيع' and s.rent_period_ar is not null
  having count(*) > 0;
end
$function$;