-- Q1 (owner 2026-08-09, SOURCE-OF-TRUTH KEEP): a sub-1000 Buy price is SOURCE-PUBLISHED and must stay
-- searchable at any magnitude — rule "no hiding source-published prices"; PR#362 proved 204/204 live
-- sub-1000 Buy rows matched their source page. search_row_price_gated() was an interim "hide Buy 1..999
-- SAR" gate. Its own comment claimed it mirrors a predicate sync_search_listings_ar folds into
-- production_ready, but sync no longer does that (verified: sync body has no <1000 gate) — pure drift.
-- The function is still called in the UNLOCATED-fallback disjunct of THREE read RPCs
-- (location_search_candidates_ar, apartment_guided_counts_ar, property_age_option_counts_ar), where it
-- would exclude a sub-1000 Buy row that ever lost production_ready. Today all 246 sub-1000 Buy rows are
-- production_ready=true, so the gate is currently INERT — but it contradicts the owner rule and could
-- bite later. NEUTRALISE the one function to a no-op (fixes all three callers at once, touches no large
-- RPC body). Full removal of the now-dead call + function is a safe future hygiene step.
--
-- Regression-guarded by scripts/verify-sub1000-buy-not-gated.ts (in `npm test`): if a future migration
-- re-introduces a price predicate here, CI fails.
create or replace function public.search_row_price_gated(p_deal_ar text, p_price_total numeric)
returns boolean language sql immutable parallel safe as $function$
  -- NEUTRALISED 2026-08-09: never gate a source-published price. Always false ⇒ nothing is ever hidden.
  select false;
$function$;
