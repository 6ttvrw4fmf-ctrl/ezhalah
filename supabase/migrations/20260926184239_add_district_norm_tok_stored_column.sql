
-- PERFORMANCE: district_options_ar()'s "live" CTE was calling norm_district_tok(district_ar) --
-- an IMMUTABLE but expensive chain of ~8 regexp_replace/translate calls -- on every row of a
-- city's cohort, on every single picker open. Measured: 577ms with the function call vs 72ms
-- reading a plain column over the identical 54,924-row cohort (الرياض) -- the function call is
-- ~88% of district_options_ar's total latency. Storing it once here (computed automatically by
-- Postgres on every insert/update, invisible to the sync pipeline) turns a per-request cost into
-- a per-write cost that already happened.
alter table public.search_listings_ar
  add column district_norm_tok text generated always as (norm_district_tok(district_ar)) stored;
