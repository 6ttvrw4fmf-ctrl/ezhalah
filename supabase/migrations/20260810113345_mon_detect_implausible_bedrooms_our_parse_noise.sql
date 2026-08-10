-- Normal Filter barrier hardening (2026-08-09/10). The bedrooms field's INGESTION barrier is complete
-- (overflow/negative/bad-cast → NULL, listing never dropped, verified fleet-wide). But an IN-RANGE
-- implausible value (e.g. wasalt 32000, sanadak_commercial 23000 bedrooms) passes the smallint/CHECK
-- guards and then leaks into a "5+" bedroom search. Spot-checks show source_capture carries no such
-- bedroom value → these are OUR parse/field-mapping mistakes, not source-published.
--
-- DETECT ONLY — never clamp/hide (source-is-truth; a magnitude gate would be a regression). A single
-- real listing cannot have >50 bedrooms, so >50 is the unambiguous "our mistake" band; the row stays
-- searchable and this view flags it for a per-scraper parser fix. (Cf. mon_detect_impossible_price_size
-- for price/area; this is the bedroom analogue that was missing.) Verified live 2026-08-09: 180 rows
-- (wasalt 71, aqar 51, sanadak_commercial 48, aqar_commercial 5, sanadak_residential 5).
create or replace view public.mon_implausible_bedrooms as
select source_table, listing_id, bedrooms, city_ar, type_ar, deal_ar
from public.search_listings_ar
where production_ready and bedrooms > 50
order by bedrooms desc;

comment on view public.mon_implausible_bedrooms is
  'DETECT-ONLY: production_ready rows with >50 bedrooms — impossible for a single listing, so OUR parse '
  'noise (source_capture carries no such value). Must trend to 0 via per-scraper parser fixes. Never '
  'clamp the value (source-is-truth). Barrier: bedrooms field, Normal Filter safety-barrier audit 2026-08-09.';
