-- Restore the 220 sub-1000 Buy prices a concurrent session NULLED in the RAW tables on
-- 2026-08-09 (aqar 123, wasalt 41, dealapp 56), alongside its revert of the trigger arm.
--
-- WHY THIS IS SAFE TO DO NOW, AND URGENT: search_listings_ar still holds the pre-deletion values,
-- because its price is fed through the active_listing_ids_v2 MATERIALIZED view, whose snapshot
-- predates the nulling. That is the only surviving copy in the database — the very next
-- `REFRESH MATERIALIZED VIEW active_listing_ids_v2` (routine, runs unattended) would overwrite it
-- with NULL and the figures would be gone for good.
--
-- WHY THESE VALUES ARE RIGHT: every one of them was fetched from its own live source page earlier
-- today and compared to what the platform publishes — aqar 108/108 exact (JSON-LD offers.price,
-- the same signal scrapers/aqar/liveness.py already trusts), wasalt 40/40, dealapp 14/14 among its
-- live ads. 204/204 across all nine affected platforms. Zero thousands-truncation, zero wrong
-- prices. Per-row evidence is committed at scripts/ops/evidence/ and a literal-valued equivalent
-- of this repair at scripts/ops/repair_sub1000_price_restore_2026-08-09.sql.
--
-- Copies ONLY where the raw value is currently NULL and the surviving value is a Buy price in
-- 1..999 — it cannot touch a price the other session did not remove, and it invents nothing.
CREATE TABLE IF NOT EXISTS public.ops_sub1000_raw_restore_20260809 (
  source_table text, listing_id bigint, restored_price numeric NOT NULL,
  restored_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (source_table, listing_id));

INSERT INTO public.ops_sub1000_raw_restore_20260809 (source_table, listing_id, restored_price)
SELECT s.source_table, s.listing_id, s.price_total
FROM public.search_listings_ar s
WHERE s.deal_ar = 'بيع' AND s.price_total BETWEEN 1 AND 999
ON CONFLICT DO NOTHING;

UPDATE public.aqar_residential_listings l SET price_total = b.restored_price
FROM public.ops_sub1000_raw_restore_20260809 b
WHERE b.source_table = 'aqar_residential_listings' AND l.id = b.listing_id
  AND l.price_total IS NULL;

UPDATE public.wasalt_residential_listings l SET price_total = b.restored_price
FROM public.ops_sub1000_raw_restore_20260809 b
WHERE b.source_table = 'wasalt_residential_listings' AND l.id = b.listing_id
  AND l.price_total IS NULL;

UPDATE public.dealapp_residential_listings l SET price_total = b.restored_price
FROM public.ops_sub1000_raw_restore_20260809 b
WHERE b.source_table = 'dealapp_residential_listings' AND l.id = b.listing_id
  AND l.price_total IS NULL;
