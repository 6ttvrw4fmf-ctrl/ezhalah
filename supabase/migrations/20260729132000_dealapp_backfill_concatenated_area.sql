-- One-time backfill for the DealApp area/price concatenation bug fixed in scrapers/dealapp/run.py
-- (_spec_value now stops at </head>, so future scrapes are correct). Only touches rows that PROVE
-- their own corruption — per the owner's extreme-price/extreme-value verify-then-preserve rule
-- ("an unrealistic-looking value is never invalid by assumption... only a PROVEN pipeline-introduced
-- error may be repaired", PR#277/#280), a blanket "area is suspiciously large" threshold is NOT
-- sufficient grounds to touch a row — a large area can be a genuine big land parcel. The gate here is
-- format-independent proof instead: area_m2's decimal text ENDS WITH price_total's decimal text (and
-- is longer) — i.e. the row's own price is literally embedded as the tail of its own area, exactly
-- the concatenation mechanism proved live against this row's own real page (2026-07-29: id 956972's
-- area 162,620,000 = "162" + price 620,000; id 2295991's area 2,061,130,000 = "206" + price
-- 1,130,000 — both independently re-scraped since and now correct on their own, presumably because
-- the source page's layout around those two ads changed; id 1274844 still reproduces the identical
-- signature as of its latest scrape, 2026-08-03).
--
-- No DB trigger derives dealapp's area_m2 (confirmed: purely a Python-scraper field, upserted as-is)
-- so nulling it here is safe and won't be immediately regenerated — the next scrape re-populates it
-- correctly through the fixed extractor ("Hidden rows self-heal on next crawl re-upsert", per the
-- same PR#277 precedent this migration follows). Same fail-closed gate-count pattern as the
-- aqar_null_licence_number_prices precedent: abort rather than touch a set that moved since this was
-- measured (2026-08-03). active rows only.
do $$
declare
  n_res constant int := 1;
  n_com constant int := 0;
  n int;
begin
  select count(*) into n from public.dealapp_residential_listings
   where active and price_total is not null and area_m2 is not null
     and length(area_m2::text) > length(price_total::text)
     and right(area_m2::text, length(price_total::text)) = price_total::text;
  if n <> n_res then
    raise exception 'dealapp_residential_listings area-concat gate matched % rows, expected % — aborting', n, n_res;
  end if;
  update public.dealapp_residential_listings
     set area_m2 = null
   where active and price_total is not null and area_m2 is not null
     and length(area_m2::text) > length(price_total::text)
     and right(area_m2::text, length(price_total::text)) = price_total::text;
  get diagnostics n = row_count;
  if n <> n_res then raise exception 'dealapp_residential_listings area-concat repair updated % rows, expected % — rolling back', n, n_res; end if;
  raise notice 'dealapp_residential_listings: % row(s) area_m2 nulled (proven concatenation signature)', n;

  select count(*) into n from public.dealapp_commercial_listings
   where active and price_total is not null and area_m2 is not null
     and length(area_m2::text) > length(price_total::text)
     and right(area_m2::text, length(price_total::text)) = price_total::text;
  if n <> n_com then
    raise exception 'dealapp_commercial_listings area-concat gate matched % rows, expected % — aborting', n, n_com;
  end if;
  raise notice 'dealapp_commercial_listings: % row(s) matched (none expected today)', n;
end $$;
