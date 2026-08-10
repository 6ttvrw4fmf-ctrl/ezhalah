-- Filter QA (2026-08-05). Durable source-level correction for token Buy prices. A Buy price
-- 0<price_total<1000 SAR is physically impossible for a sale = a parse artifact (rendered-text/street
-- id), never a source-published structured price. Per the owner price invariant (structured price, or
-- store NO price) the correct source value is NULL. The row-sanity trigger already nulls these in the
-- derived search table, but the SOURCE tables still hold the tokens, so the sync keeps re-reading them
-- and a concurrent revert of the trigger briefly re-exposed 221 rows. Correcting the SOURCE (the value
-- flowing into v2/sync) makes it durable and independent of the trigger. Prices are NOT hidden — the
-- listing stays searchable and shows "price on request" until the real structured price is captured.
-- Backup for reversibility. Upstream follow-up: scraper parser must store NULL (not a rendered-text
-- token) when there is no structured offers.price.
create table if not exists public.ops_buy_token_price_null_backup_20260809 (
  source_table text, id bigint, old_price_total bigint, backed_up_at timestamptz default now()
);
insert into public.ops_buy_token_price_null_backup_20260809 (source_table, id, old_price_total)
select 'aqar_residential_listings', id, price_total from public.aqar_residential_listings where price_total between 1 and 999 and transaction_type ilike 'buy'
union all select 'dealapp_residential_listings', id, price_total from public.dealapp_residential_listings where price_total between 1 and 999 and transaction_type ilike 'buy'
union all select 'wasalt_residential_listings', id, price_total from public.wasalt_residential_listings where price_total between 1 and 999 and transaction_type ilike 'buy';

update public.aqar_residential_listings    set price_total = null where price_total between 1 and 999 and transaction_type ilike 'buy';
update public.dealapp_residential_listings set price_total = null where price_total between 1 and 999 and transaction_type ilike 'buy';
update public.wasalt_residential_listings  set price_total = null where price_total between 1 and 999 and transaction_type ilike 'buy';
