-- 🔬 AF engineer 2026-10-08: staging for evidence-backed Advanced Filter backfills computed in CI by the
-- repo's own readers (read-only over listings). A reviewed migration applies rows from here; nothing here
-- is read by the app. Service role only.
create table if not exists public.ops_af_backfill_staging (
  id          bigserial primary key,
  batch       text        not null,
  src_table   text        not null check (src_table ~ '^[a-z0-9_]+_listings$'),
  listing_id  bigint      not null,
  col         text        not null check (col ~ '^[a-z_]+$'),
  val         text        not null,
  created_at  timestamptz not null default now(),
  unique (batch, src_table, listing_id, col)
);
alter table public.ops_af_backfill_staging enable row level security;
revoke all on public.ops_af_backfill_staging from anon, authenticated;