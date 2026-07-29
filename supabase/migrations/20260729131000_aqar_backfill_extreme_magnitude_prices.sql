-- One-time backfill for the guard added in 20260729130000 — nulls the ALREADY-STORED rows that
-- already violate it (the guard only protects future writes; existing bad rows survive until they're
-- next re-scraped/re-triggered). Same "honest NULL beats a fabricated price" philosophy and the same
-- fail-closed gate-count pattern as 20260728210000_aqar_null_licence_number_prices.sql — abort rather
-- than touch a set that moved since this was measured (2026-07-29). active rows only, matching that
-- precedent (inactive listings aren't shown to users; a reactivation re-triggers trg_aqar_parse and
-- gets the new guard for free). price_per_meter is nulled ONLY where it is arithmetically derived from
-- the value being removed (±1 of round(price/area)) — a source-published «سعر المتر» is left alone,
-- per scripts/verify-aqar-trigger-preserves-source-ppm.ts.
do $$
declare
  n_res_buy  constant int := 565;
  n_com_buy  constant int := 7;
  n_res_rent constant int := 51;
  n_com_rent constant int := 26;
  n int;
begin
  -- aqar_residential_listings, Buy
  select count(*) into n from public.aqar_residential_listings
   where active and transaction_type='Buy' and price_total is not null and (
     (area_m2 is not null and area_m2 > 0 and price_total::numeric/area_m2 > 2000000)
     or (coalesce(area_m2,0) = 0 and price_total::numeric > 5000000000));
  if n <> n_res_buy then
    raise exception 'aqar_residential_listings Buy gate matched % rows, expected % — aborting', n, n_res_buy;
  end if;
  update public.aqar_residential_listings a
     set price_total = null,
         price_per_meter = case
           when a.area_m2 > 0 and a.price_per_meter is not null
            and abs(a.price_per_meter - round(a.price_total::numeric / a.area_m2)) <= 1
           then null else a.price_per_meter end,
         fullparse_done = true
   where a.active and a.transaction_type='Buy' and a.price_total is not null and (
     (a.area_m2 is not null and a.area_m2 > 0 and a.price_total::numeric/a.area_m2 > 2000000)
     or (coalesce(a.area_m2,0) = 0 and a.price_total::numeric > 5000000000));
  get diagnostics n = row_count;
  if n <> n_res_buy then raise exception 'aqar_residential_listings Buy repair updated % rows, expected % — rolling back', n, n_res_buy; end if;
  raise notice 'aqar_residential_listings Buy: % row(s) nulled', n;

  -- aqar_commercial_listings, Buy
  select count(*) into n from public.aqar_commercial_listings
   where active and transaction_type='Buy' and price_total is not null and (
     (area_m2 is not null and area_m2 > 0 and price_total::numeric/area_m2 > 2000000)
     or (coalesce(area_m2,0) = 0 and price_total::numeric > 5000000000));
  if n <> n_com_buy then
    raise exception 'aqar_commercial_listings Buy gate matched % rows, expected % — aborting', n, n_com_buy;
  end if;
  update public.aqar_commercial_listings a
     set price_total = null,
         price_per_meter = case
           when a.area_m2 > 0 and a.price_per_meter is not null
            and abs(a.price_per_meter - round(a.price_total::numeric / a.area_m2)) <= 1
           then null else a.price_per_meter end,
         fullparse_done = true
   where a.active and a.transaction_type='Buy' and a.price_total is not null and (
     (a.area_m2 is not null and a.area_m2 > 0 and a.price_total::numeric/a.area_m2 > 2000000)
     or (coalesce(a.area_m2,0) = 0 and a.price_total::numeric > 5000000000));
  get diagnostics n = row_count;
  if n <> n_com_buy then raise exception 'aqar_commercial_listings Buy repair updated % rows, expected % — rolling back', n, n_com_buy; end if;
  raise notice 'aqar_commercial_listings Buy: % row(s) nulled', n;

  -- aqar_residential_listings, Rent (price_annual; no price_per_meter analog for rent to clean up)
  select count(*) into n from public.aqar_residential_listings
   where active and transaction_type='Rent' and price_annual is not null
     and area_m2 is not null and area_m2 > 0 and price_annual::numeric/area_m2 > 500000;
  if n <> n_res_rent then
    raise exception 'aqar_residential_listings Rent gate matched % rows, expected % — aborting', n, n_res_rent;
  end if;
  update public.aqar_residential_listings a
     set price_annual = null, fullparse_done = true
   where a.active and a.transaction_type='Rent' and a.price_annual is not null
     and a.area_m2 is not null and a.area_m2 > 0 and a.price_annual::numeric/a.area_m2 > 500000;
  get diagnostics n = row_count;
  if n <> n_res_rent then raise exception 'aqar_residential_listings Rent repair updated % rows, expected % — rolling back', n, n_res_rent; end if;
  raise notice 'aqar_residential_listings Rent: % row(s) nulled', n;

  -- aqar_commercial_listings, Rent
  select count(*) into n from public.aqar_commercial_listings
   where active and transaction_type='Rent' and price_annual is not null
     and area_m2 is not null and area_m2 > 0 and price_annual::numeric/area_m2 > 500000;
  if n <> n_com_rent then
    raise exception 'aqar_commercial_listings Rent gate matched % rows, expected % — aborting', n, n_com_rent;
  end if;
  update public.aqar_commercial_listings a
     set price_annual = null, fullparse_done = true
   where a.active and a.transaction_type='Rent' and a.price_annual is not null
     and a.area_m2 is not null and a.area_m2 > 0 and a.price_annual::numeric/a.area_m2 > 500000;
  get diagnostics n = row_count;
  if n <> n_com_rent then raise exception 'aqar_commercial_listings Rent repair updated % rows, expected % — rolling back', n, n_com_rent; end if;
  raise notice 'aqar_commercial_listings Rent: % row(s) nulled', n;
end $$;
