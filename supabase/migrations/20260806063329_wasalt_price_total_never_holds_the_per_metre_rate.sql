-- PRICE = SOURCE (owner invariant): the price on the source website IS the price Ezhalah stores.
--
-- DEFECT (proven 2026-08-06, 27 ACTIVE + production_ready + served rows):
-- `scrapers/wasalt/run.py:330` writes price_total from the SEARCH-LIST payload's `salePrice`. For
-- land ads that wasalt prices by the square metre, that slot carries the per-METRE rate, not the
-- total. The row's OWN stored detail payload publishes the two as DISTINCT fields:
--     ar_data.propertyInfo.salePrice              = the total          (5,100,000)
--     ar_data.propertyInfo.averageSalePricePerSqm = the per-metre rate (7,500)
-- and 7,500 x 680 m2 = 5,100,000 exactly — the stored figure is arithmetically this listing's own
-- unit rate, not a price change. So id 445386, a 5.1M SAR Riyadh plot, was SERVED at "7,500 SAR"
-- and matched every "Buy under 10,000" price filter.
--
-- WHY A ONE-OFF REPAIR CANNOT HOLD (the actual reason this is back):
-- 20260804193711 already repaired 22 rows of exactly this class on 2026-08-04 19:37. Every one of
-- them was silently reverted within 24h — the next list-crawl (last_seen_at 2026-08-05 23:2x-23:3x)
-- re-asserted the per-metre rate. Repairing rows without closing the write path is a no-op with a
-- 24-hour half-life. The guard therefore goes in the ingestion path, and the row repair follows it.
--
-- WHY THE TRIGGER IS THE RIGHT LAYER: at list-crawl time the Python scraper has only the list
-- payload; the detail payload lives in the DB column. This trigger is the only place both values
-- coexist, so it is the only place the contradiction is visible.
--
-- NEVER COMPUTES A PRICE: the repaired value is read verbatim from the source's own salePrice field.
-- DIRECTIONAL ON PURPOSE: only the UNDERSTATING clobber (detail total >= 10x incoming) is the
-- proven ppm-as-total class. The inverse cohort (9 apartment rows storing 1000x ABOVE a captured
-- salePrice=579) has an unproven direction and is deliberately left untouched, as 20260804193711
-- also chose. A >=10x gap cannot be an ordinary price change; same-magnitude drift is left alone.

create table if not exists ops_wasalt_ppm_as_total_backup_20260806 as
select id, price_total, price_per_meter, area_m2, transaction_type, property_type, listing_url,
       (ar_data->'propertyInfo'->>'salePrice') as src_sale_price,
       (ar_data->'propertyInfo'->>'averageSalePricePerSqm') as src_ppm,
       last_seen_at, now() as backed_up_at
  from wasalt_residential_listings
 where active and transaction_type = 'Buy' and price_total is not null
   and (ar_data->'propertyInfo'->>'salePrice') ~ '^\d+(\.\d+)?$'
   and (ar_data->'propertyInfo'->>'salePrice')::numeric >= price_total::numeric * 10;

-- 1. Close the write path. Guarded rebuild: keep the existing additional_info behaviour verbatim.
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

  -- price_total must never hold the per-square-metre rate. See the migration header.
  IF NEW.transaction_type = 'Buy' AND NEW.price_total IS NOT NULL THEN
    DECLARE
      src text := coalesce(NEW.ar_data, OLD.ar_data) -> 'propertyInfo' ->> 'salePrice';
    BEGIN
      IF src ~ '^\d+(\.\d+)?$'
         AND src::numeric >= NEW.price_total::numeric * 10 THEN
        NEW.price_total := src::numeric::bigint;
      END IF;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. Repair the rows the reverted 08-04 pass left serving a unit rate as a total.
update wasalt_residential_listings t
   set price_total = (t.ar_data->'propertyInfo'->>'salePrice')::numeric::bigint,
       price_per_meter = coalesce(
         nullif((t.ar_data->'propertyInfo'->>'averageSalePricePerSqm')::numeric, 0)::int,
         t.price_per_meter)
 where t.active
   and t.transaction_type = 'Buy'
   and t.price_total is not null
   and (t.ar_data->'propertyInfo'->>'salePrice') ~ '^\d+(\.\d+)?$'
   and (t.ar_data->'propertyInfo'->>'salePrice')::numeric >= t.price_total::numeric * 10;

-- 3. Propagate to the served search index immediately (the hourly sync would otherwise leave users
--    looking at the wrong price for up to an hour).
update search_listings_ar s
   set price_total = w.price_total::numeric
  from wasalt_residential_listings w
 where s.source_table = 'wasalt_residential_listings'
   and s.listing_id = w.id
   and w.id in (select id from ops_wasalt_ppm_as_total_backup_20260806)
   and s.price_total is distinct from w.price_total::numeric;
