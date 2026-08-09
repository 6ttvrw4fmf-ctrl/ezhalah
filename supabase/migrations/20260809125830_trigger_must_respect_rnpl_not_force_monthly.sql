-- THE REAL ROOT CAUSE of "annual rent payable monthly can still enter Monthly".
--
-- enforce_price_size_sanity() is a BEFORE trigger on search_listings_ar. It carried:
--     if NEW.rent_period_ar = 'شهري' then NEW.payment_monthly := true;
-- — an UNCONDITIONAL force that ignored rent_now_pay_later entirely. Because it fires on EVERY
-- write, it silently overrode sync_payment_monthly(): the sweep set payment_monthly=false for an
-- RNPL row, the trigger fired on that very UPDATE and set it straight back to true. The sweep even
-- reported "1 row corrected" while the row never actually changed — the guard was inverted by the
-- thing that runs last.
--
-- Caught behaviourally on 2026-08-09: aqar_residential_listings id 23235 — rent_period_ar='شهري',
-- rent_now_pay_later=true — stayed payment_monthly=true across repeated sweeps. Fixing
-- sync_payment_monthly() alone (migration 20260809120630) was NOT enough; that function is not the
-- last writer. This is why the RNPL exclusion looked correct in the source but not in the data.
--
-- Owner PERMANENT rule 2026-08-09: annual rent with monthly instalments / RNPL is ANNUAL, on EVERY
-- platform. The trigger must now agree with sync_payment_monthly() exactly — one rule, both writers:
--     شهري  → payment_monthly = NOT rent_now_pay_later
--     سنوي  → payment_monthly = false
--     otherwise → leave untouched (unknown stays unknown; never manufactured)
-- Everything else in this trigger is preserved byte-for-byte.
CREATE OR REPLACE FUNCTION public.enforce_price_size_sanity()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if public.price_size_impossible(NEW.price_total, NEW.price_annual, NEW.area_m2) then
    NEW.production_ready := false;
  end if;
  if NEW.deal_ar = 'بيع'
     and NEW.price_total is not null and NEW.price_total > 0 and NEW.price_total < 1000 then
    NEW.price_total := null;
  end if;
  if NEW.type_ar is not null
     and not exists (select 1 from public.known_type_ar k where k.type_ar = NEW.type_ar) then
    NEW.type_ar := 'غير معروف';
  end if;
  -- RNPL = an ANNUAL contract paid in instalments. It must NEVER become Monthly, on any platform.
  -- Same predicate as sync_payment_monthly(); the two writers can no longer disagree.
  if NEW.rent_period_ar = 'شهري' then
    NEW.payment_monthly := not coalesce(NEW.rent_now_pay_later, false);
  elsif NEW.rent_period_ar = 'سنوي' then
    NEW.payment_monthly := false;
  end if;
  return NEW;
end $function$;
