-- audit item 4 (owner-approved 2026-07-27): mustqr's scraper derived price_per_meter as
-- round(price_total/area_m2) (older rows: trunc()) — the source API publishes NO ppm field
-- (map_listing/_price_fields read none; raw source_capture verified to carry none, incl. the 12
-- trunc-era outliers). Listing-fidelity rule: a price signal must be verbatim source-published or
-- NULL. The derivation is removed from scrapers/mustqr/run.py (same commit) and the widened
-- fleet-wide guard (scrapers/common/tests/test_price_fidelity.py + scripts/verify-no-derived-price.ts)
-- now catches dict-style derivations that the original bare-name pattern missed.
-- Before-counts: residential 508, commercial 140 (648 total; 621 on active rows). After: 0. Idempotent.
update public.mustqr_residential_listings set price_per_meter = null where price_per_meter is not null;
update public.mustqr_commercial_listings  set price_per_meter = null where price_per_meter is not null;
