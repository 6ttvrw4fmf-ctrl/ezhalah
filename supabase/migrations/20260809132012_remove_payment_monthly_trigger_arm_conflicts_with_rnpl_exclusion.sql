-- Remove my payment_monthly=(rent_period_ar='شهري') trigger arm. It fights the owner's dedicated
-- sync_payment_monthly cron, which DELIBERATELY sets payment_monthly=false for rent-now-pay-later
-- rows (migration 20260719120000_sync_payment_monthly_excludes_aqar_rnpl_contradiction): an RNPL
-- installment (e.g. aqar 23235: 580 SAR/month financing on a 78,000 annual) is NOT a genuine monthly
-- rental, so it must not surface in monthly rent search. The QA's "aqar 23235 findability gap" was a
-- FALSE POSITIVE — that row is correctly excluded from period-specific monthly search by owner design.
-- Restoring the trigger to what PR#362 left: price_size_impossible + untaxonomized-type route only.
create or replace function public.enforce_price_size_sanity()
 returns trigger
 language plpgsql
as $function$
begin
  if public.price_size_impossible(NEW.price_total, NEW.price_annual, NEW.area_m2) then
    NEW.production_ready := false;
  end if;
  if NEW.type_ar is not null
     and not exists (select 1 from public.known_type_ar k where k.type_ar = NEW.type_ar) then
    NEW.type_ar := 'غير معروف';
  end if;
  return NEW;
end $function$;
