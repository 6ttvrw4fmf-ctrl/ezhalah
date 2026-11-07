-- Owner session 2026-11-07: every customer click since 2026-06-18 was rejected (HTTP 409).
-- clicks.listing_id still referenced listings_legacy, but cards now carry search_listings_ar ids
-- (globally unique, 451,310 = 451,310 distinct), so each insert violated the foreign key and the
-- app swallowed the error. Click (CPC billing) telemetry was silently empty for ~5 months.
alter table public.clicks drop constraint if exists clicks_listing_id_fkey;
comment on column public.clicks.listing_id is
  'search_listings_ar.listing_id of the opened card (globally unique). No FK: listings rotate in and out of the index; a click is a historical event.';
