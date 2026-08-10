-- FILTER PARITY BARRIER — mirror of the applied migration (the DB is authoritative).
-- Squashes 20260810133206 → 20260810133803 → 20260810144023; the earlier two encoded period
-- semantics that were corrected the same hour (see the companion migration for that history).
--
-- Final semantics, owner-confirmed 2026-08-10:
--   genuine شهري (not RNPL)   -> MONTHLY only
--   سنوي                       -> ANNUAL only
--   annual/RNPL paid monthly   -> ANNUAL only
--   unknown period             -> NEITHER
--   ANNUAL ∩ MONTHLY           = 0
--
-- BEHAVIOURAL, not source-inspecting: it calls the REAL production RPCs, so it cannot report green
-- while production is broken. That property is the whole point — the black hole it was written for
-- was invisible to every count-vs-count check, because all three RPCs shared the same wrong clause.
-- Any row returned is a FAILURE; an empty result is healthy.
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
         'a non-RNPL شهري rental that the annual bucket would return'::text,
         count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='إيجار' and s.rent_period_ar='شهري'
    and not coalesce(s.rent_now_pay_later,false)
    and (s.rent_period_ar='سنوي' or (s.rent_period_ar='شهري' and coalesce(s.rent_now_pay_later,false)))
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
  foreach v_per in array array['سنوي','شهري']
  loop
    select count(*) into v_results from public.location_search_candidates_ar(
      p_deal:='إيجار', p_rent_period:=v_per, p_cities:=array['الرياض'], p_tables:=v_res,
      p_tables2:=v_com, p_types:=array['شقة'], p_types2:=array['شقة'],
      p_category:='Residential', p_limit:=1000000);
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

comment on function public.mon_filter_parity_barrier() is
  'Behavioural Filter barrier (owner 2026-08-10). Final period semantics: genuine شهري -> Monthly; '
  'سنوي -> Annual; annual/RNPL-paid-monthly -> Annual only; unknown -> neither; Annual n Monthly = 0. '
  'Also asserts results RPC = guided count = age count for BOTH periods. Any row returned is a '
  'FAILURE.';
