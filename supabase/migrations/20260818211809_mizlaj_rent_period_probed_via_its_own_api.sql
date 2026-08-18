-- Data Integrity run #29 follow-up: mizlaj was the last waiver without conclusive evidence.
--
-- Its listing pages are client-rendered, so a static fetch returned HTTP 200 without the figure and
-- was recorded INCONCLUSIVE; Chromium cannot traverse this environment's egress proxy. The
-- resolution was to probe the endpoint OUR OWN SCRAPER ingests -
-- GET https://mizlaj.com.sa/api/guest/listings/map-data - which is the authoritative source for
-- everything we store from this platform.
--
-- Result (2026-08-18, HTTP 200, 28 records): each record carries 31 fields -
--   ad_license_number, broker_id, broker_logo_url, broker_name, city, city_id, company_id,
--   created_at, district, district_id, id, is_broker_listing, is_featured, is_reserved, latitude,
--   listing_status_id, location, longitude, max_price, min_price, name, price_per_meter,
--   property_type, published_at, reference_number, slug, space, total_price,
--   user_has_minimum_price_request, user_id, user_requested_minimum_price
-- and NOT ONE of them is period-related: no period, rent_period, duration, billing, monthly or
-- annual field exists in the payload at all.
--
-- Two of our period-less rows were matched by slug in the same response, with prices identical to
-- what we store:
--   aakar-1200m2-llaygar-alryad-mM6QhxpG  total_price 60000  (our 1034061, 60000)
--   aakar-7332m2-llaygar-alryad-GGGhDd93  total_price 40000  (our 1034062, 40000)
-- and the names read «عقار 1200م² للإيجار - الرياض» - rent, with no period stated.
--
-- This is the same bar aqar met in run #22: the platform's own structured payload read live, the
-- field genuinely absent rather than merely missing from our capture. mizlaj's waiver is KEEP.

insert into public.ops_rent_period_source_probe
  (source_table, listing_id, probed_at, http_status, observed_subtype, method, evidence)
values
 ('mizlaj_residential_listings', 1034061, now(), 200, null, 'run29_live_api',
  'GET /api/guest/listings/map-data (the endpoint our scraper ingests): slug matched, total_price=60000 == stored; payload has 31 fields and NO period/rent_period/duration/billing key'),
 ('mizlaj_residential_listings', 1034062, now(), 200, null, 'run29_live_api',
  'GET /api/guest/listings/map-data: slug matched, total_price=40000 == stored; payload has 31 fields and NO period/rent_period/duration/billing key');

update public.ops_rent_period_sourceless
   set reason = reason || ' || run #29 live re-probe 2026-08-18 via the platform''s OWN API '
                          '(/api/guest/listings/map-data, the endpoint our scraper ingests): HTTP 200, '
                          '31 fields per record, NO period-related field exists in the payload at all; '
                          'two of our period-less rows matched by slug with identical prices. The '
                          'listing pages are client-rendered, which is why the static probe was '
                          'recorded inconclusive - the API settles it.'
 where platform = 'mizlaj';
