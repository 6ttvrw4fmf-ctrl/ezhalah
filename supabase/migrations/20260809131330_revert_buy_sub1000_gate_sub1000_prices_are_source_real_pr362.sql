-- REVERT of my erroneous sub-1000 Buy price gate. PR#362 (parallel session, 2026-08-09) PROVED
-- sub-1000 Buy prices are SOURCE-REAL by fetching all 204 live source pages (aqar 108/108, wasalt
-- 40/40, aqargate 20/20, eaqartabuk 14/14, dealapp 14/14, eastabha 6/6, sanadak 4/4, aqarcity 1/1,
-- hajer 1/1 — 204/204 exact, zero thousands-truncation; sanadak «للبيع 868», hajer «550ر.س»),
-- de-gated 9 scrapers + this trigger, and marked it "do NOT re-investigate". I re-added the gate and
-- nulled the raw prices — the concurrent revert PR#362 explicitly warned about. Removing my Buy<1000
-- arm; keeping price_size_impossible (PR#362 left it untouched), the untaxonomized-type route, and the
-- payment_monthly=(rent_period_ar='شهري') reconciliation. Rebuilt by needle-edit from the live def.
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
  if NEW.rent_period_ar = 'شهري' then
    NEW.payment_monthly := true;
  elsif NEW.rent_period_ar = 'سنوي' then
    NEW.payment_monthly := false;
  end if;
  return NEW;
end $function$;
