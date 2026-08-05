-- PRICE = SOURCE, layer 6 in action (owner invariant 2026-08-04): wasalt already captures the
-- platform's OWN price in ar_data.propertyInfo.salePrice, so its whole Buy inventory can be
-- corroborated with a query instead of 42,654 page fetches. Result: 42,618 agree, 36 disagree.
--
-- This repairs ONLY the 22 rows where the disagreement is provably a pipeline error: the stored
-- value is a per-square-metre-magnitude number (source_price / stored >= 10) while wasalt's own
-- salePrice is the real total — the ppm-as-total class already repaired for 7 rows in
-- 20260804184833, here found at full-price magnitudes the token-price band never surfaced.
-- The new value is READ FROM THE SOURCE'S OWN FIELD, never computed, and price_per_meter is set
-- to the source's own averageSalePricePerSqm where it publishes one (that IS the per-metre rate).
--
-- DELIBERATELY NOT TOUCHED (they are not this class):
--   • 5 rows differing by <10x (435799, 443074, 451130, 534035, 3557546) — same-magnitude
--     differences = ordinary source price changes; the crawler refreshes those.
--   • 9 rows (520292/520294/520296/525615/525619/525903/525906/525908/525909) where the stored
--     value is 1000x ABOVE the captured salePrice=579. Direction is inverted, wasalt pages are
--     403 from outside Saudi, and the evidence alone cannot say whether the source changed or the
--     capture is stale — flagged for the owner rather than guessed at.
update wasalt_residential_listings t
   set price_total = (t.ar_data->'propertyInfo'->>'salePrice')::bigint,
       price_per_meter = nullif((t.ar_data->'propertyInfo'->>'averageSalePricePerSqm')::numeric, 0)::int
 where t.active
   and t.transaction_type = 'Buy'
   and t.price_total is not null
   and (t.ar_data->'propertyInfo'->>'salePrice') ~ '^\d+(\.\d+)?$'
   and (t.ar_data->'propertyInfo'->>'salePrice')::numeric >= t.price_total::numeric * 10;

update search_listings_ar s
   set price_total = (w.ar_data->'propertyInfo'->>'salePrice')::numeric
  from wasalt_residential_listings w
 where s.source_table = 'wasalt_residential_listings'
   and s.listing_id = w.id
   and w.active and w.transaction_type = 'Buy'
   and (w.ar_data->'propertyInfo'->>'salePrice') ~ '^\d+(\.\d+)?$'
   and s.price_total is not null
   and (w.ar_data->'propertyInfo'->>'salePrice')::numeric >= s.price_total::numeric * 10;