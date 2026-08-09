-- Filter QA (2026-08-05). Enforce payment_monthly = (rent_period_ar='شهري') in the row-sanity trigger.
--
-- One aqar rent row (23235) carried rent_period_ar='شهري' but payment_monthly=false. Period membership
-- is decided by payment_monthly (monthly search) and rent_period_ar='سنوي' (annual search), so a row
-- where the two disagree falls out of BOTH period-specific Rent searches — a findability under-return
-- (NOT leakage: it never entered a wrong bucket). The two fields are derived independently at ingestion
-- and the dedicated sync-payment-monthly cron can briefly write one without the other. Enforcing the
-- invariant here makes period membership always consistent, self-heals on every write, fleet-wide.
-- rent_period_ar IS NULL (period unknown) is left untouched so those rows correctly surface only in a
-- no-period Rent search. Regression: mon_filter_qa.period_payment_mismatch (must be 0).
--
-- This is a CREATE OR REPLACE that carries forward the three earlier branches of this trigger unchanged
-- (price_size_impossible → production_ready=false; impossible sub-1000 Buy token → price_total=null,
--  20260809113900; untaxonomized type_ar → 'غير معروف', 20260809115820) and only appends the
-- payment_monthly reconciliation. Body captured verbatim from the live function.
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
