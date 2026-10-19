-- loc_city_map was a production-only table: no committed migration creates it, yet the pipeline reads it
-- (resolve_english_city_overlay, loc_classify, …) and 20261003203736 inserts into it. Found by
-- scripts/verify-committed-sql-defines-what-it-calls.ts the moment a migration of ours referenced it
-- (🆕 New Listings Engineer, 2026-10-03). Recovered per that script's rule («recover, never baseline»)
-- from the LIVE catalog: three NOT NULL text columns, primary key on city_key, RLS on with no policy
-- (the service role and SECURITY DEFINER functions read it). IF NOT EXISTS + an idempotent RLS
-- statement: a no-op against production, a faithful create anywhere else.
create table if not exists public.loc_city_map (
  city_key  text not null,
  city_ar   text not null,
  region_ar text not null,
  constraint loc_city_map_pkey primary key (city_key)
);
alter table public.loc_city_map enable row level security;
