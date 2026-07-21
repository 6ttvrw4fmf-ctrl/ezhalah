-- Recovered verbatim from production supabase_migrations.schema_migrations on 2026-07-21 (drift
-- reconciliation — applied to prod by a concurrent session ~10:26 but not yet committed to git; the
-- deploy drift gate flagged it as missing_in_git). Idempotent (create index if not exists).

-- Fix: wasalt Arabic-enrichment residential job failing since 2026-07-17 with Postgres 57014
-- (statement timeout) in enrich_ar.py's err-retry query:
--   select ... from wasalt_residential_listings
--   where active and ar_fetched and ar_data->'_err' is not null and ar_data->'_parked' is null
--     and ar_fetched_at < :cutoff order by ar_fetched_at limit :n
-- The retry pool is tiny (1 row at time of fix) but the predicate is unindexed and ar_data is a
-- large TOASTed jsonb — the scan detoasts ar_data for a huge fraction of the ~129k-row table
-- before finding enough matches, blowing the statement timeout. A partial index pays the detoast
-- cost once at build time; afterwards the query touches only the (tiny) matching set, already
-- ordered by ar_fetched_at. Same index on commercial for symmetry (works today only because that
-- table is smaller — same growth path, same failure ahead).
create index if not exists idx_wasalt_res_ar_err_retry
  on public.wasalt_residential_listings (ar_fetched_at)
  where active and ar_fetched and (ar_data->'_err') is not null and (ar_data->'_parked') is null;

create index if not exists idx_wasalt_com_ar_err_retry
  on public.wasalt_commercial_listings (ar_fetched_at)
  where active and ar_fetched and (ar_data->'_err') is not null and (ar_data->'_parked') is null;
