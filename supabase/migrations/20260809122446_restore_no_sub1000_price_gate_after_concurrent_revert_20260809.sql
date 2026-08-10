-- RE-APPLY the sub-1000 removal. A concurrent session re-added the arm within ~2h of
-- migration drop_sub1000_buy_price_null_gate_source_verified_20260809 (same class of incident as
-- PR#289's guard revert, 2026-08-03) AND nulled the underlying raw prices on aqar/wasalt/dealapp.
--
-- Rebuilt by NEEDLE-EDIT from the LIVE pg_get_functiondef, not from my earlier copy: the other
-- session also ADDED a third arm (untaxonomized type_ar -> 'غير معروف'), which is preserved here
-- verbatim. Only the magnitude arm is removed.
--
-- The removed arm's premise is disproven, per-row, against the sources (2026-08-09): every live
-- sub-1000 Buy row was fetched from its own page and 204/204 stored prices equalled the price the
-- platform publishes — aqar 108/108 (JSON-LD offers.price), wasalt 40/40, aqargate 20/20,
-- eaqartabuk 14/14, dealapp 14/14 live, eastabha 6/6, sanadak 4/4 (badge «للبيع 868»), aqarcity
-- 1/1, hajer 1/1 (source prints the range «550.00ر.س -- 600 الف ر.س»). ZERO thousands-truncation.
-- These are advertiser data-entry conventions mirrored faithfully — the class the extreme-price
-- verify-then-preserve rule says to KEEP — and nulling them violates the standing owner rule of
-- 2026-08-03 that a source-published price stays displayed and searchable at ANY magnitude.
--
-- If the owner wants these hidden, that is a product decision and must change the RULE first;
-- until then this gate stays out. price_size_impossible() (>50bn SAR / >5M m² / >5M SAR-per-m²,
-- production_ready only, destroys nothing) is UNCHANGED.
CREATE OR REPLACE FUNCTION public.enforce_price_size_sanity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if public.price_size_impossible(NEW.price_total, NEW.price_annual, NEW.area_m2) then
    NEW.production_ready := false;
  end if;
  if NEW.type_ar is not null
     and not exists (select 1 from public.known_type_ar k where k.type_ar = NEW.type_ar) then
    NEW.type_ar := 'غير معروف';   -- untaxonomized/leaked type → reachable Unknown bucket
  end if;
  return NEW;
end $function$;
