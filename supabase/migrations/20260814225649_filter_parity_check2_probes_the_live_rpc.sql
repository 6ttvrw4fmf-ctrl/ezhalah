-- mon_filter_parity_barrier check (2) was tautologically false and could NEVER fire.
--
--   where s.rent_period_ar='شهري' and not coalesce(rnpl,false)
--     and (s.rent_period_ar='سنوي' or (s.rent_period_ar='شهري' and coalesce(rnpl,false)))
--
-- `P and not R and (Q or (P and R))` over ONE column is a contradiction: no row state can
-- satisfy it. Proven 2026-08-15 with 31,859 genuine-monthly rows live plus one hand-built
-- maximally-adversarial row — the check returned 0 rows.
--
-- What it let through: editing af_eligibility_clause() so the سنوي bucket also accepts plain
-- شهري, then running the sanctioned rebuild_af_filter_rpcs(), moved the إيجار→سنوي→شقة cohort
-- from 21,019 to 51,379 (+30,360 genuine-monthly listings priced per MONTH served as ANNUAL)
-- with mon_af_predicate_parity, mon_check_filter_parity_legacy, mon_check_normal_filter_barrier,
-- mon_detect_filter_barrier_leaks, mon_rich_attrs_barrier and mon_af_new_listing_readiness all
-- returning 0. Every other check derives from that same clause, so they drift together; this
-- was the only INDEPENDENT oracle for the period bucket, and it was inert.
--
-- Fix: stop restating the predicate and ask the LIVE results RPC what it actually returns,
-- then judge those rows against source truth. Also covers unknown-period rows leaking in.
--
-- Mutation-proven: clean = 0 rows; same clause drift = n 30,360 plus one hourly alert via
-- mon_check_filter_parity_legacy (cron jobid 71). Whole barrier runs in ~2.4 s.
--
-- Needle-edit of the LIVE definition, never a hand-typed full-body replace (a full replace
-- silently reverts whatever else landed on this function since it was last read). The needle
-- and its replacement are declared text literals so scripts/lib/rpcReplay.ts can model this
-- migration instead of reporting it as an uninterpretable rewrite.
do $mig$
declare
  anchor text := '  select ''genuine_monthly_leaked_into_annual''::text,
         ''a non-RNPL شهري rental that the annual bucket would return''::text,
         count(*)::bigint
  from public.search_listings_ar s
  where s.deal_ar=''إيجار'' and s.rent_period_ar=''شهري''
    and not coalesce(s.rent_now_pay_later,false)
    and (s.rent_period_ar=''سنوي'' or (s.rent_period_ar=''شهري'' and coalesce(s.rent_now_pay_later,false)))
  having count(*) > 0;';
  replace_with text := '  select ''genuine_monthly_leaked_into_annual''::text,
         ''the LIVE سنوي results RPC returned a listing that is not annual by source (non-RNPL شهري, or no period at all) — the 12x understatement shape''::text,
         count(*)::bigint
  from public.location_search_candidates_ar(
         p_deal:=''إيجار'', p_rent_period:=''سنوي'', p_types:=array[''شقة''], p_limit:=1000000) c
  join public.search_listings_ar s
    on s.source_table = c.source_table and s.listing_id = c.listing_id
  where not (s.rent_period_ar=''سنوي''
             or (s.rent_period_ar=''شهري'' and coalesce(s.rent_now_pay_later,false)))
  having count(*) > 0;';
  def text;
  newdef text;
begin
  def := pg_get_functiondef('public.mon_filter_parity_barrier()'::regprocedure);
  newdef := replace(def, anchor, replace_with);
  if newdef = def then
    raise exception 'mon_filter_parity_barrier check (2) needle not found — read the live definition before re-applying';
  end if;
  execute newdef;
end $mig$;
