-- OWNER-APPROVED (2026-08-04, senior audit run #5): close the Buy token-price gate leak.
--
-- THE DEFECT. sync_search_listings_ar folds the owner-approved interim gate (20260803112311) into
-- production_ready:
--     (v.production_ready and not (lower(v.transaction_type)='buy'
--                                  and v.price_total is not null
--                                  and v.price_total > 0 and v.price_total < 1000))
-- so every gated row already carries production_ready = false. But all three read paths waive
-- production_ready entirely when the caller passes no location filter:
--     where (s.production_ready or ((p_cities is null or cardinality(p_cities) = 0)
--                               and (p_districts is null or cardinality(p_districts) = 0)
--                               and p_region_ids is null))
-- so a plain "Buy" browse — and the AI agent, which calls the same RPC — returned 100% of the gated
-- cohort (267/267 measured immediately before this migration; 0 once any city filter is applied).
-- It read as healthy for two audit runs because mon_buy_token_price counts the FLAG, not the RPC.
--
-- WHY THE WAIVER STAYS. It is not a bug in itself: production_ready also means "canonical location
-- resolved", and hiding a listing from an unfiltered browse merely because its district did not
-- resolve would be wrong (honest-NULL). 978 no-city rows rely on it and must keep browsing. So this
-- migration does NOT remove the waiver — it removes only the gated price cohort from it.
--
-- ONE DEFINITION, NOT FOUR. The gate predicate is factored into search_row_price_gated() rather than
-- pasted into three RPCs. Copy-pasted invariants drifting apart is precisely the defect class that
-- bit this codebase twice in the last 24h (PR#289 reverting PR#286's dealapp guards; 20260803194308
-- rebuilding mon_run_all_detectors from a stale base and dropping a detector). One function means the
-- three read paths cannot disagree with each other; the sync-side definition it mirrors is asserted
-- by mon_detect_search_gate_leak(), which measures the RPC rather than the flag.
--
-- The three function bodies are rewritten by exact substring replacement on pg_get_functiondef(),
-- and the DO block raises if the clause is not found verbatim — so nothing is patched blind and no
-- other line of those functions can change.
--
-- VERIFIED LIVE after apply:
--   unfiltered gated 267 -> 0; with-city gated 0 -> 0 (unchanged)
--   unfiltered Buy rows 105,948 -> 105,681 = exactly -267, nothing else lost
--   no-city not-ready rows still browsable (782 returned) — the waiver's real purpose is intact
--   Rent path unchanged (75,603)
--   all three RPCs agree exactly: results 105,681 = apartment_guided_counts_ar.cnt_total_base
--     105,681 = property_age_option_counts_ar.cnt_total 105,681 = SQL ground truth 105,681
--   predicate inlines (plan shows the De Morgan expansion in the seq-scan filter, no per-row call);
--     298 ms unfiltered / 322 ms city-filtered — no regression
--   mon_detect_search_gate_leak() returns 0

create or replace function public.search_row_price_gated(p_deal_ar text, p_price_total numeric)
 returns boolean
 language sql
 immutable
 parallel safe
as $function$
  -- The owner-approved interim Buy token-price gate, in one place. Mirrors the predicate
  -- sync_search_listings_ar folds into production_ready. A Buy listing priced 1..999 SAR is a
  -- token/placeholder price, not a real one; it stays stored EXACTLY as the source published it
  -- (fidelity rule) but must not be searchable.
  select p_deal_ar = 'بيع'
     and p_price_total is not null
     and p_price_total > 0
     and p_price_total < 1000;
$function$;

comment on function public.search_row_price_gated(text, numeric) is
  'Owner-approved Buy token-price gate predicate. Single source of truth for the three _ar read paths; mirrors the clause sync_search_listings_ar folds into production_ready. Verified live by mon_detect_search_gate_leak().';

do $mig$
declare
  fn text;
  def text;
  newdef text;
  old_clause constant text :=
    'where (s.production_ready or ((p_cities is null or cardinality(p_cities) = 0) and (p_districts is null or cardinality(p_districts) = 0) and p_region_ids is null))';
  new_clause constant text :=
    'where (s.production_ready or ((p_cities is null or cardinality(p_cities) = 0) and (p_districts is null or cardinality(p_districts) = 0) and p_region_ids is null and not public.search_row_price_gated(s.deal_ar, s.price_total)))';
begin
  foreach fn in array array[
    'location_search_candidates_ar',
    'apartment_guided_counts_ar',
    'property_age_option_counts_ar'
  ] loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = fn;

    if def is null then
      raise exception 'search gate fix: function public.% not found', fn;
    end if;
    if position(old_clause in def) = 0 then
      raise exception 'search gate fix: waiver clause not found verbatim in public.% — refusing to patch blind', fn;
    end if;

    newdef := replace(def, old_clause, new_clause);

    if position(new_clause in newdef) = 0 then
      raise exception 'search gate fix: replacement produced no change in public.%', fn;
    end if;

    execute newdef;
    raise notice 'search gate fix: patched public.%', fn;
  end loop;
end $mig$;
