-- RESTORE the payment_monthly / RNPL block that a full-body replace silently dropped.
--
-- Timeline (2026-08-09, hours apart):
--   12:58  20260809125830 added to enforce_price_size_sanity():
--              if NEW.rent_period_ar = 'شهري' then
--                NEW.payment_monthly := not coalesce(NEW.rent_now_pay_later, false);
--              elsif NEW.rent_period_ar = 'سنوي' then NEW.payment_monthly := false;
--              end if;
--          so the trigger could no longer defeat the RNPL exclusion.
--   later  a parallel change re-issued the whole function to REMOVE the sub-1000 Buy price gate
--          (correct and deliberate — owner rule: never hide a source-published price). But it was
--          written from an OLDER body, so it also deleted the payment_monthly block above.
--
-- Caught by the new replay-aware checker: the repo replays to md5 2957ce97… while production had
-- 2d104260…. This is the stale-body copy hazard, and it is precisely why the owner asked for a
-- checker that understands the real replayed state.
--
-- This migration takes the CURRENT live body (keeping the intended sub-1000 removal) and re-adds ONLY
-- the period block. Net effect on data: none — payment_monthly was already correct via
-- sync_payment_monthly() and the read-layer guard; this restores agreement between the three writers
-- so no single future edit can quietly re-open the hole.
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
    NEW.type_ar := 'غير معروف';
  end if;
  -- NOTE: the sub-1000 Buy price gate was deliberately removed upstream (owner rule: a
  -- source-published price is never hidden, at any magnitude). Do NOT reinstate it here.
  --
  -- RNPL = an ANNUAL contract paid in instalments; it must NEVER become Monthly, on any platform.
  -- Identical predicate to sync_payment_monthly() and to the شهري bucket in the search/counts RPCs,
  -- so writer, trigger and reader can never disagree. (owner PERMANENT rule 2026-08-09.)
  if NEW.rent_period_ar = 'شهري' then
    NEW.payment_monthly := not coalesce(NEW.rent_now_pay_later, false);
  elsif NEW.rent_period_ar = 'سنوي' then
    NEW.payment_monthly := false;
  end if;
  return NEW;
end $function$;
