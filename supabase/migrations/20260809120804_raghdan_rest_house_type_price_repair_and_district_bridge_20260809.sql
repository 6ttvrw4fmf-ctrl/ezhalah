-- (1) Repair the 2 raghdan rows whose TYPE was the page title, which also destroyed their PRICE.
--
-- Root cause (fixed forward in scrapers/raghdan/run.py): raghdan kept a private copy of the
-- canonical type map that had drifted — it lacked the hamza-alif spelling «إستراحة» (only the bare
-- «استراحة» was present), so _map_type() returned None and the scraper stored the whole page title
-- as the property type. The unmapped type then fell through to the routing default
-- "Residential Land", which routes a Buy price as a PER-METER RATE — so the source's TOTAL was
-- written to price_per_meter and price_total was left NULL. One drift, three defects.
--
-- LIVE SOURCE EVIDENCE (fetched 2026-08-09, both pages HTTP 200):
--   id 1034238  https://raghdan.sa/ar/property/LvvDJWlk7pxivHuhSI3s/
--       JSON-LD name «إستراحة للبيع في الودي، حائل»; offers.price = 400000, businessFunction Sell;
--       floorSize 423.06 m²; meta description «السعر: ٤٠٠٬٠٠٠ SAR». No «سعر المتر» label anywhere
--       on the page -> the published figure is a TOTAL, not a rate.
--   id 1034239  https://raghdan.sa/ar/property/r12bRwRm6PlOYyVybZGc/
--       same shape; offers.price = 4000000; floorSize 500 m²; meta «السعر: ٤٬٠٠٠٬٠٠٠ SAR».
-- Stored price_per_meter (400000 / 4000000) is the same number in the WRONG column — a rate the
-- source never published — so it is reset to NULL per the source-published-only rule. No price is
-- invented: price_total is set to exactly the figure the page prints.
CREATE TABLE IF NOT EXISTS public.ops_raghdan_type_price_repair_20260809 (
  listing_id bigint PRIMARY KEY,
  old_property_type text, new_property_type text,
  old_price_total numeric, new_price_total numeric,
  old_price_per_meter numeric,
  evidence text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now());

INSERT INTO public.ops_raghdan_type_price_repair_20260809
  (listing_id, old_property_type, new_property_type, old_price_total, new_price_total,
   old_price_per_meter, evidence)
SELECT l.id, l.property_type, 'Rest House', l.price_total, v.new_total, l.price_per_meter, v.evidence
FROM (VALUES
  (1034238, 400000::numeric, 'live page LvvDJWlk7pxivHuhSI3s: JSON-LD offers.price=400000 (Sell), meta «السعر: ٤٠٠٬٠٠٠ SAR», no سعر المتر label; title «إستراحة …» -> Rest House'),
  (1034239, 4000000::numeric, 'live page r12bRwRm6PlOYyVybZGc: JSON-LD offers.price=4000000 (Sell), meta «السعر: ٤٬٠٠٠٬٠٠٠ SAR», no سعر المتر label; title «إستراحة …» -> Rest House')
) AS v(id, new_total, evidence)
JOIN public.raghdan_residential_listings l ON l.id = v.id
ON CONFLICT (listing_id) DO NOTHING;

UPDATE public.raghdan_residential_listings l
SET property_type   = b.new_property_type,
    price_total     = b.new_price_total,
    price_per_meter = NULL
FROM public.ops_raghdan_type_price_repair_20260809 b
WHERE l.id = b.listing_id;

-- (2) Carry the source-published DISTRICT through the raghdan city bridge.
-- resolve_raghdan_city()'s ON CONFLICT guard only fired when city_ar changed, so rows whose city
-- was already bridged never picked up the district the backfill recovered. Widen the guard and
-- fill the existing rows. Districts are copied verbatim from the raw table (which holds exactly
-- what the «الحى» field on the page printed) — the catalog still decides whether one resolves.
UPDATE public.listings_arabic_locations lal
SET raw_district = coalesce(lal.raw_district, r.neighborhood),
    district_ar  = coalesce(lal.district_ar,  r.neighborhood)
FROM public.raghdan_residential_listings r
WHERE lal.source_table = 'raghdan_residential_listings'
  AND lal.listing_id = r.id
  AND r.neighborhood IS NOT NULL
  AND lal.district_ar IS NULL;

CREATE OR REPLACE FUNCTION public.resolve_raghdan_city()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare tbl text; total int := 0; n int;
begin
  foreach tbl in array array['raghdan_residential_listings','raghdan_commercial_listings']
  loop
    if to_regclass('public.'||tbl) is null then
      continue;
    end if;
    execute format($q$
      with gap as (
        select r.id, s.platform, s.deal_ar, r.city, r.neighborhood
        from public.search_listings_ar s
        join public.%1$I r on r.id = s.listing_id
        where s.source_table = %2$L
          and (s.city_id is null
               or (s.district_ar is null and r.neighborhood is not null))
          and r.city is not null
      ),
      ins as (
        insert into public.listings_arabic_locations
          (index_id, platform, source_table, listing_id, purpose,
           raw_city_en, city_ar, region_ar, raw_district, district_ar, matched, review_reason)
        select %2$L||':'||g.id::text, g.platform, %2$L, g.id,
               case when g.deal_ar='بيع' then 'buy' else 'rent' end,
               g.city, m.city_ar, m.region_ar, g.neighborhood, g.neighborhood,
               true, 'english_map_overlay'
        from gap g
        join public.loc_city_map m on m.city_key = lower(btrim(g.city))
        on conflict (index_id) do update
          set city_ar       = excluded.city_ar,
              region_ar     = excluded.region_ar,
              raw_city_en   = excluded.raw_city_en,
              raw_district  = coalesce(public.listings_arabic_locations.raw_district, excluded.raw_district),
              district_ar   = coalesce(public.listings_arabic_locations.district_ar, excluded.district_ar),
              matched       = true,
              review_reason = 'english_map_overlay'
          where public.listings_arabic_locations.city_ar is distinct from excluded.city_ar
             or (public.listings_arabic_locations.district_ar is null
                 and excluded.district_ar is not null)
        returning 1
      )
      select count(*) from ins
    $q$, tbl, tbl) into n;
    total := total + coalesce(n,0);
  end loop;
  return total;
end $function$;
