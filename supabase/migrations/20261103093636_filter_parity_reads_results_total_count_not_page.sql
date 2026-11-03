-- 🔬 2026-11-03 (alert 10376 filter_parity_legacy, P1 open since 2026-10-21): check (6) of mon_filter_parity_barrier()
-- counted the ROWS location_search_candidates_ar returned, but that RPC pages at most 5,000 rows per call
-- (least(p_limit, 5000)) and carries the full match size in its own total_count column. Measured: Riyadh apartments,
-- rent سنوي: rows 5,000, total_count 49,579, guided 49,579, age-count 49,579 — the three surfaces agree and the check
-- read «guided 49579 vs results 5000». It now reads the results RPC's total_count (what the page shows as the count),
-- and still compares it with BOTH count surfaces. Every other check is unchanged.
create or replace function public.mon_filter_parity_barrier()
 returns table(check_name text, detail text, n bigint)
 language plpgsql
 stable
as $function$
declare
  v_res text[]; v_com text[];
  v_per text; v_results bigint; v_guided bigint; v_age bigint;
begin
  select array_agg(table_name::text) into v_res from information_schema.tables
   where table_schema='public' and table_name like '%\_residential\_listings';
  select array_agg(table_name::text) into v_com from information_schema.tables
   where table_schema='public' and table_name like '%\_commercial\_listings';

  -- (1) ANNUAL-PAID-MONTHLY MUST NEVER ENTER MONTHLY.
  return query
  select 'rnpl_annual_leaked_into_monthly'::text,
         'an RNPL/instalment rental classified as genuine monthly — the 12x understatement shape'::text,
         count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='إيجار' and coalesce(s.rent_now_pay_later,false) and coalesce(s.payment_monthly,false)
  having count(*) > 0;

  -- (2) GENUINE MONTHLY MUST NEVER BECOME ANNUAL.
  return query
  select 'genuine_monthly_leaked_into_annual'::text,
         'the LIVE سنوي results RPC returned a listing that is not annual by source (non-RNPL شهري, or no period at all) — the 12x understatement shape'::text,
         count(*)::bigint
  from public.af_cohort_registry reg
  cross join lateral public.location_search_candidates_ar(
         p_deal:=reg.deal_ar, p_rent_period:=reg.rent_period_ar,
         p_types:=array[reg.type_ar], p_limit:=1000000) c
  join public.search_listings_ar s
    on s.source_table = c.source_table and s.listing_id = c.listing_id
  where reg.enabled and reg.deal_ar='إيجار' and reg.rent_period_ar='سنوي'
    and s.price_annual is not null  -- price on request is in every period by design (owner 2026-09-28)
    and not (s.rent_period_ar='سنوي'
             or (s.rent_period_ar='شهري' and coalesce(s.rent_now_pay_later,false)))
  having count(*) > 0;

  -- (3) UNKNOWN PERIOD MUST NEVER DEFAULT INTO EITHER BUCKET.
  return query
  select 'unknown_period_defaulted_into_a_bucket'::text,
         'a rental with NO source period that either bucket would return'::text,
         count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='إيجار' and s.rent_period_ar is null
    and (coalesce(s.payment_monthly,false)
         or (s.rent_period_ar='سنوي' or (s.rent_period_ar='شهري' and coalesce(s.rent_now_pay_later,false))))
  having count(*) > 0;

  -- (4) MUTUAL EXCLUSION: ANNUAL ∩ MONTHLY = 0.
  return query
  select 'row_in_both_period_buckets'::text,
         'a rental reachable as BOTH annual and monthly'::text, count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='إيجار'
    and coalesce(s.payment_monthly,false)
    and (s.rent_period_ar='سنوي' or (s.rent_period_ar='شهري' and coalesce(s.rent_now_pay_later,false)))
  having count(*) > 0;

  -- (5) REACHABILITY: a STATED period must land in exactly one bucket.
  return query
  select 'stated_period_reachable_by_neither'::text,
         'production_ready rental with a stated period matching neither bucket — unreachable'::text,
         count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='إيجار' and s.production_ready and s.rent_period_ar is not null
    and not coalesce(s.payment_monthly,false)
    and not (s.rent_period_ar='سنوي' or (s.rent_period_ar='شهري' and coalesce(s.rent_now_pay_later,false)))
  having count(*) > 0;

  -- (6) COUNT RPC = RESULTS RPC, for BOTH periods and across all three count surfaces the UI reads.
  -- The results RPC pages at most 5,000 rows; its total_count column is the full match size (2026-11-03).
  foreach v_per in array array['سنوي','شهري']
  loop
    select coalesce(max(c.total_count), 0) into v_results from public.location_search_candidates_ar(
      p_deal:='إيجار', p_rent_period:=v_per, p_cities:=array['الرياض'], p_tables:=v_res,
      p_tables2:=v_com, p_types:=array['شقة'], p_types2:=array['شقة'],
      p_category:='Residential', p_limit:=1) c;
    select g.cnt_total_base into v_guided from public.apartment_guided_counts_ar(
      p_deal:='إيجار', p_rent_period:=v_per, p_cities:=array['الرياض'], p_tables:=v_res,
      p_tables2:=v_com, p_types:=array['شقة'], p_types2:=array['شقة'], p_category:='Residential') g;
    select a.cnt_total into v_age from public.property_age_option_counts_ar(
      p_deal:='إيجار', p_rent_period:=v_per, p_cities:=array['الرياض'], p_tables:=v_res,
      p_tables2:=v_com, p_types:=array['شقة'], p_types2:=array['شقة'], p_category:='Residential') a;

    if v_guided is distinct from v_results then
      return query select 'guided_count_vs_results'::text,
        format('%s: guided %s vs results %s', v_per, v_guided, v_results)::text,
        abs(coalesce(v_guided,0)-coalesce(v_results,0))::bigint;
    end if;
    if v_age is distinct from v_results then
      return query select 'age_count_vs_results'::text,
        format('%s: age-count total %s vs results %s', v_per, v_age, v_results)::text,
        abs(coalesce(v_age,0)-coalesce(v_results,0))::bigint;
    end if;
  end loop;

  -- (7) BUY/RENT SEPARATION.
  return query
  select 'buy_listing_carrying_a_rent_period'::text,
         'a بيع listing carrying a rent period'::text, count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='بيع' and s.rent_period_ar is not null
  having count(*) > 0;
end
$function$;
