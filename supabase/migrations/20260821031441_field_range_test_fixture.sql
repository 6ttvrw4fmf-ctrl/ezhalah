-- Permanent fixture table for the composite-baseline regression guard
-- (scripts/verify-run-field-range-composite-baseline-live.ts). It carries the exact 10 columns
-- mon_check_run_field_ranges() requires plus property_type variance, and is truncated/reseeded on
-- every run of that script -- never touched by any scraper, never real listing data. service_role
-- only (same access pattern as ops_deploy_lock): anon/authenticated get nothing.
create table if not exists public.ops_test_field_range_synthetic (
  id              bigserial primary key,
  ad_number       text,
  listing_url     text,
  property_type   text,
  transaction_type text,
  price_total     numeric,
  price_annual    numeric,
  city            text,
  region          text,
  active          boolean,
  last_seen_at    timestamptz
);

comment on table public.ops_test_field_range_synthetic is
  'Synthetic-data fixture for the mon_check_run_field_ranges composite-baseline regression guard '
  '(scripts/verify-run-field-range-composite-baseline-live.ts, 2026-08-21). Truncated and reseeded '
  'on every run of that script. Never written by any scraper; carries no real listing data.';

revoke all on public.ops_test_field_range_synthetic from anon, authenticated;
grant all on public.ops_test_field_range_synthetic to service_role;
grant usage, select on sequence public.ops_test_field_range_synthetic_id_seq to service_role;
