-- The search-loading strip (SearchLoader.tsx) shows one logo per platform users can currently
-- reach in search results. The loader roster is the app's public claim about which platforms it
-- searches; if a scraper goes cold, its logo should stop appearing without a deploy — the roster
-- must equal the ACTUAL production active set, not a hardcoded aspiration.
--
-- This RPC is the single truth source: the distinct set of `platform` values with any row in
-- `search_listings_ar` (the anon-readable production search index). It is what the client filters
-- the static PLATFORM_META down to on every app open. The static list stays present as a safe-
-- degradation fallback if the RPC ever fails.
--
-- CHEAP by design. `search_listings_ar` has ~200k rows and Postgres runs the DISTINCT via an
-- index-only scan on `platform`. Measured at ~200ms on 2026-08-29.
create or replace function public.loader_active_platforms_ar()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct platform order by platform), '{}'::text[])
  from public.search_listings_ar
  where platform is not null and platform <> '';
$$;

comment on function public.loader_active_platforms_ar() is
  'Distinct platform values with active searchable listings. Consumed by the client search-loading strip so a platform with zero reachable rows never advertises a logo. See src/data/loaderPlatforms.ts (fetchActivePlatformNames) and scripts/verify-loader-platforms-match-active.ts. Owner rule 2026-08-29.';

-- Anon + authenticated MUST be able to call this — the app is public and the loader runs before
-- sign-in. security definer + explicit search_path keeps it safe against schema hijack.
revoke all on function public.loader_active_platforms_ar() from public;
grant execute on function public.loader_active_platforms_ar() to anon, authenticated;
