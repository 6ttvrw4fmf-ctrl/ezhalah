-- pw-prc=0 is this source's own "على السوم" (price on request / negotiable) sentinel, never a
-- real SAR 0 listing. Found live-testing as a real user: a card displayed "ر.س 0" for a plot whose
-- own description says "على السوم". Measured: 18/262 rows, all 18 negotiable, raw pw-prc literally
-- "0" in every one (confirmed exhaustively, not sampled). Backfilled to honest NULL here; the
-- scraper (scrapers/amlakalahsa/run.py) is fixed in the same commit to never store 0 again.
update public.amlakalahsa_residential_listings
set price_total = null
where price_total = 0
  and source_capture->>'pw-prc' = '0';