-- Filter QA (2026-08-05). Token-price Buy fix — CORRECT the value, do NOT hide the row (owner
-- directive). A Buy price 0<price_total<1000 SAR is physically impossible for a sale; it is a parse
-- artifact (a street/id number scraped from aqar's rendered price slot, or a stale token the strict
-- ≥50,000 parser no longer overwrites). Per the owner price invariant (structured source price, or
-- store NO price) these must be NULL ("السعر عند الطلب" / price on request) — never a fabricated
-- number. This nulls the impossible price while KEEPING production_ready=true (the listing stays
-- searchable — this is a data correction, not the search-hide gate the owner rejected). The real
-- structured price (aqar JSON-LD offers.price) still flows in via enrich_residential/liveness where
-- the source actually publishes one. Runs on every search_listings_ar write (sync) → durable, self-
-- healing. Regression: check_audit_invariants asserts 0 production_ready Buy rows with price<1000.
create or replace function public.enforce_price_size_sanity()
 returns trigger
 language plpgsql
as $function$
begin
  if public.price_size_impossible(NEW.price_total, NEW.price_annual, NEW.area_m2) then
    NEW.production_ready := false;
  end if;
  if NEW.deal_ar = 'بيع'
     and NEW.price_total is not null and NEW.price_total > 0 and NEW.price_total < 1000 then
    NEW.price_total := null;   -- impossible sale price → price on request, row stays searchable
  end if;
  return NEW;
end $function$;
