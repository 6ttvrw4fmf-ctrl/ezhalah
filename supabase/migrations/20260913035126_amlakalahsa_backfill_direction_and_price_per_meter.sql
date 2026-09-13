-- The amlakalahsa scraper (scrapers/amlakalahsa/run.py) never read two ACF keys it should have:
-- pw-front (facade/direction, a single-element JSON array like ["شمالي"] on 37/262 rows) and
-- pw-prc-mtr (price per meter, a plain positive-int string on 82/262 rows, with 4 more rows
-- carrying WordPress ACF's negative "unset" sentinel -1/-2/-5 which are NOT real prices).
-- source_capture already holds the raw ACF payload for every row scraped so far, so this
-- backfills existing data immediately rather than waiting for the next crawl to pick up the
-- matching scraper fix (same commit). amlakalahsa_commercial_listings has 0 rows today, nothing
-- to backfill there.
update public.amlakalahsa_residential_listings
set direction = (source_capture->'pw-front'->>0)
where jsonb_typeof(source_capture->'pw-front') = 'array'
  and jsonb_array_length(source_capture->'pw-front') = 1
  and direction is null;

update public.amlakalahsa_residential_listings
set price_per_meter = (source_capture->>'pw-prc-mtr')::int
where (source_capture->>'pw-prc-mtr') ~ '^[0-9]+$'
  and (source_capture->>'pw-prc-mtr')::int > 0
  and price_per_meter is null;