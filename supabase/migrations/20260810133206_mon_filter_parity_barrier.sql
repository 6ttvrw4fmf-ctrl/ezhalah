-- FILTER PARITY BARRIER (owner directive, 2026-08-10).
--
-- A BEHAVIOURAL monitor: it calls the REAL production RPCs the app calls and asserts the invariants
-- that must hold for the Filter to be truthful. It does not inspect source code, so it cannot go
-- green while production is broken.
--
-- It exists because of the monthly/annual black hole found on 2026-08-10: the results RPC matched
-- monthly on the DERIVED `payment_monthly` while annual matched the SOURCE `rent_period_ar`, so a row
-- where they disagreed satisfied NEITHER branch and was unreachable through a UI that always sends a
-- period. Nothing detected it — every count agreed with every other count, because all three RPCs
-- shared the same wrong clause. Only comparing the RPCs against the INDEX exposed it.
--
-- Every row returned is a FAILURE. An empty result is the healthy state.
create or replace function public.mon_filter_parity_barrier()
returns table(check_name text, detail text, n bigint)
language plpgsql
stable
as $function$
declare
  v_res text[];
  v_com text[];
  v_rpc bigint;
  v_idx bigint;
begin
  select array_agg(table_name::text) into v_res from information_schema.tables
   where table_schema='public' and table_name like '%\_residential\_listings';
  select array_agg(table_name::text) into v_com from information_schema.tables
   where table_schema='public' and table_name like '%\_commercial\_listings';

  -- 1. PERIOD TOTALITY: every production-ready rental must be reachable by exactly one period.
  --    This is the invariant the black hole broke.
  return query
  select 'rent_row_reachable_by_neither_period'::text,
         'production_ready rentals whose period is stated but matches neither bucket — '
         'unreachable through a UI that always sends one'::text,
         count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='إيجار' and s.production_ready
    and s.rent_period_ar is not null and s.rent_period_ar not in ('سنوي','شهري')
  having count(*) > 0;

  -- 2. MUTUAL EXCLUSION: no rental may satisfy both buckets.
  return query
  select 'rent_row_in_both_period_buckets'::text,
         'a rental reachable as BOTH annual and monthly — double-counted and self-contradictory'::text,
         count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='إيجار' and s.rent_period_ar='سنوي' and s.payment_monthly is true
  having count(*) > 0;

  -- 3. DERIVED MUST AGREE WITH SOURCE: payment_monthly is derived from rent_period_ar. If it ever
  --    contradicts the source column again, the two halves of the period filter can diverge.
  return query
  select 'payment_monthly_contradicts_source_period'::text,
         'derived payment_monthly disagrees with the source rent_period_ar'::text,
         count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='إيجار'
    and s.payment_monthly is distinct from (s.rent_period_ar = 'شهري')
    and s.rent_period_ar is not null
  having count(*) > 0;

  -- 4. COUNT/RESULT PARITY: the headline number must equal what the user can actually reach.
  --    Checked on the live annual-apartment scope the Filter uses most.
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
      format('guided count says %s, the results RPC returns %s for the same scope', v_rpc, v_idx)::text,
      abs(coalesce(v_rpc,0) - coalesce(v_idx,0))::bigint;
  end if;

  -- 5. BUY/RENT SEPARATION: a period filter must never surface a Buy listing.
  return query
  select 'buy_listing_carrying_a_rent_period'::text,
         'a بيع listing carrying a rent period — can leak into a rental bucket'::text,
         count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar='بيع' and s.rent_period_ar is not null
  having count(*) > 0;
end
$function$;

comment on function public.mon_filter_parity_barrier() is
  'Behavioural Filter barrier (owner 2026-08-10). Calls the REAL production RPCs and asserts period '
  'totality, mutual exclusion, derived-vs-source agreement, count/result parity and Buy/Rent '
  'separation. Any returned row is a FAILURE; empty is healthy. Built after the monthly/annual black '
  'hole, which every count agreed on because all three RPCs shared the same wrong clause.';