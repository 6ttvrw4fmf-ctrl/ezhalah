-- Filter QA (2026-08-05). Reachability fix: a scraper occasionally leaks a full ad title
-- ("إستراحة للبيع في الودي، حائل") or an untaxonomized word ("مستشفى") into property_type, so type_ar
-- lands OUTSIDE known_type_ar. The RPC's category-purity gate then excludes the row from every group
-- AND no-type search → a genuine listing becomes unreachable. Route any type_ar not in the catalog to
-- 'غير معروف' (the existing reachable Unknown bucket, macro='both') so the listing is findable via a
-- no-type search. Documented unknown-type behaviour — NOT a taxonomy change and NOT type inference;
-- the novel-type alarm (jobid 33) still flags the raw value for owner triage, and the scraper-side
-- guard against title-shaped property_type is the upstream follow-up. Folded into the row-sanity
-- trigger so it re-applies on every write (self-healing, all platforms). Applied to prod as 20260809115820.
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
  return NEW;
end $function$;
