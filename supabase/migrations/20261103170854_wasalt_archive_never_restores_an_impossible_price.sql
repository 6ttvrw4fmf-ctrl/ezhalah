-- PRICE = SOURCE: a STALE archive must not veto a price wasalt has since corrected (2026-11-03).
--
-- DEFECT (measured live 2026-11-03, 5 active served rows). wasalt_preserve_detail() — added by the
-- 2026-08-06 per-metre-rate migration — restores ar_data.propertyInfo.salePrice whenever the incoming
-- list price is >= 10x smaller. ar_data is written once by enrich_ar and never refreshed, so when wasalt
-- later CORRECTED a price the trigger put the old one back on every crawl. WST5893701: archived 2026-08-28
-- salePrice 1,046,250,000 with averageSalePricePerSqm 3,100,000; wasalt's live page today shows salePrice
-- 3,100,000 with averageSalePricePerSqm 9,185 (and the same updatedAt, so a timestamp cannot tell them apart).
-- Same for WST5915507 (3,346,875,000 → 8,925,000), WST5915502 (984,150,000 → 2,430,000), WST5952115
-- (3,038,000,000 → 4,340,000) and WST5952114 (1,875,000,000 → 3,000,000).
--
-- THE DISCRIMINATOR is the archive's OWN per-metre rate. In the class the 2026-08-06 guard exists for, the
-- archive's averageSalePricePerSqm is a real rate (7,500 SAR/m² on id 445386) and the list carried it as
-- the price. In every stale row above the archive's "rate" is 2.4M-8.9M SAR/m² — beyond the fleet's own
-- physical bound for any single unit (mon_detect_field_integrity: > 2,000,000 SAR/m² Buy). An archive whose
-- own rate is impossible cannot prove the incoming smaller number is a rate, so it no longer overrides it.
-- A missing or non-numeric archive rate keeps the 2026-08-06 behaviour exactly. Nothing is computed: the
-- value stored is still either the incoming list price or the archive's verbatim salePrice.

create or replace function public.wasalt_preserve_detail()
returns trigger
language plpgsql
as $function$
BEGIN
  IF OLD.detail_enriched AND NOT NEW.detail_enriched THEN
    NEW.additional_info := OLD.additional_info;
    NEW.detail_enriched := true;
  ELSIF OLD.detail_enriched AND NEW.detail_enriched
        AND coalesce(jsonb_array_length(NEW.additional_info), 0)
          < coalesce(jsonb_array_length(OLD.additional_info), 0) THEN
    NEW.additional_info := OLD.additional_info;  -- keep the richer stored panel
  END IF;

  -- price_total must never hold the per-square-metre rate (20260806063329) — but a stale archive whose
  -- own per-metre rate is physically impossible may not veto a corrected price (2026-11-03).
  IF NEW.transaction_type = 'Buy' AND NEW.price_total IS NOT NULL THEN
    DECLARE
      src text := coalesce(NEW.ar_data, OLD.ar_data) -> 'propertyInfo' ->> 'salePrice';
      rate text := coalesce(NEW.ar_data, OLD.ar_data) -> 'propertyInfo' ->> 'averageSalePricePerSqm';
    BEGIN
      IF src ~ '^\d+(\.\d+)?$'
         AND src::numeric >= NEW.price_total::numeric * 10
         AND NOT (rate ~ '^\d+(\.\d+)?$' AND rate::numeric > 2000000) THEN
        NEW.price_total := src::numeric::bigint;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- Repair the 5 measured rows to the price wasalt publishes today. Guarded on the stale value, so a row a
-- crawl already fixed (or that moved) is left alone. Watched by mon_detect_field_integrity: a regression to
-- the old figure is > 2,000,000 SAR/m² again and re-raises field_integrity_extreme_magnitude.
update public.wasalt_residential_listings set price_total = 3100000 where id = 9431433  and price_total = 1046250000;
update public.wasalt_residential_listings set price_total = 8925000 where id = 13746442 and price_total = 3346875000;
update public.wasalt_residential_listings set price_total = 2430000 where id = 13746443 and price_total = 984150000;
update public.wasalt_residential_listings set price_total = 4340000 where id = 16527251 and price_total = 3038000000;
update public.wasalt_residential_listings set price_total = 3000000 where id = 16527252 and price_total = 1875000000;