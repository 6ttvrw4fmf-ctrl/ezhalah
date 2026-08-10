-- Filter QA (2026-08-05). One aqar rent row (23235) had rent_period_ar='شهري' but payment_monthly=false,
-- so it fell out of BOTH period searches (monthly needs payment_monthly=true; annual needs 'سنوي') — a
-- findability under-return (NOT leakage; it never entered a wrong bucket). payment_monthly and
-- rent_period_ar are derived independently at ingestion and disagreed on this one row. Enforce the
-- invariant payment_monthly = (rent_period_ar='شهري') in the row-sanity trigger so period membership is
-- always consistent (self-healing, all platforms). rent_period_ar=null (period-unknown) is left
-- untouched → those rows correctly surface only in a no-period Rent search. Regression: mon_filter_qa
-- gains period_payment_mismatch (must be 0).
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
    NEW.price_total := null;
  end if;
  if NEW.type_ar is not null
     and not exists (select 1 from public.known_type_ar k where k.type_ar = NEW.type_ar) then
    NEW.type_ar := 'غير معروف';
  end if;
  if NEW.rent_period_ar = 'شهري' then
    NEW.payment_monthly := true;
  elsif NEW.rent_period_ar = 'سنوي' then
    NEW.payment_monthly := false;
  end if;
  return NEW;
end $function$;
