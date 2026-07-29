-- One-time backfill for the DealApp area/price concatenation bug fixed in scrapers/dealapp/run.py
-- (_spec_value now stops at </head>, so future scrapes are correct) and scrapers/common/db.py
-- (_sanitize_ints now nulls any area_m2 > 1,000,000 m² as a backstop for every platform). This
-- migration only cleans up rows already written before the fix. No DB trigger derives dealapp's
-- area_m2 (confirmed: purely a Python-scraper field, upserted as-is) so nulling it here is safe and
-- won't be immediately regenerated — the next scrape re-populates it correctly through the fixed
-- extractor. Same fail-closed gate-count pattern as the aqar backfills in this batch: abort rather
-- than touch a set that moved since this was measured (2026-07-29). active rows only.
do $$
declare
  n_res constant int := 22;
  n_com constant int := 1;
  n int;
begin
  select count(*) into n from public.dealapp_residential_listings
   where active and area_m2::numeric > 1000000;
  if n <> n_res then
    raise exception 'dealapp_residential_listings area gate matched % rows, expected % — aborting', n, n_res;
  end if;
  update public.dealapp_residential_listings
     set area_m2 = null
   where active and area_m2::numeric > 1000000;
  get diagnostics n = row_count;
  if n <> n_res then raise exception 'dealapp_residential_listings area repair updated % rows, expected % — rolling back', n, n_res; end if;
  raise notice 'dealapp_residential_listings: % row(s) area_m2 nulled', n;

  select count(*) into n from public.dealapp_commercial_listings
   where active and area_m2::numeric > 1000000;
  if n <> n_com then
    raise exception 'dealapp_commercial_listings area gate matched % rows, expected % — aborting', n, n_com;
  end if;
  update public.dealapp_commercial_listings
     set area_m2 = null
   where active and area_m2::numeric > 1000000;
  get diagnostics n = row_count;
  if n <> n_com then raise exception 'dealapp_commercial_listings area repair updated % rows, expected % — rolling back', n, n_com; end if;
  raise notice 'dealapp_commercial_listings: % row(s) area_m2 nulled', n;
end $$;
