-- LIVE SCALE NUMBERS FOR THE SEARCH-LOADING ANIMATION (owner 2026-09-12): "those things are more
-- like marketing... people would be like wow, this has a big database" — three real counts (total
-- searchable listings, distinct cities, distinct districts) baked into the rotating loading copy,
-- pulled live every time, never hardcoded in the client. Mirrors loader_active_platforms_ar()'s own
-- pattern (SECURITY DEFINER over search_listings_ar, anon-callable) so this stays consistent with
-- how the same screen already sources its platform count.
--
-- SCOPE = production_ready (owner "count surface shares the results scope" convention): the same
-- gate every other count surface in this app uses, so this number can never overstate what a real
-- search can actually reach.
--
-- DISTRICT COUNT is canonical, not raw text: (city_id, norm_district_tok(district_ar)) — a spelling
-- twin (جدة صفا / صفاء) must count as ONE place, not two, or the marketing number would be inflated
-- by exactly the bug 2026-09-12's district-identity-fold PR closed. Measured identical to a raw-text
-- count today (the fold already canonicalises district_ar at write time) but this is the ROBUST
-- form, not a coincidence this migration should depend on holding forever.
create or replace function public.loader_scale_stats_ar()
returns table(listing_count integer, city_count integer, district_count integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    count(*)::int as listing_count,
    count(distinct city_id)::int as city_count,
    count(distinct (city_id, norm_district_tok(district_ar)))
      filter (where district_ar is not null and district_ar <> '')::int as district_count
  from public.search_listings_ar
  where production_ready = true;
$$;

revoke all on function public.loader_scale_stats_ar() from public;
grant execute on function public.loader_scale_stats_ar() to anon, authenticated, service_role;

comment on function public.loader_scale_stats_ar() is
  'Live scale numbers for the search-loading animation copy (owner 2026-09-12): total searchable '
  'listings, distinct cities, and distinct districts among production_ready rows. Every number is '
  'derived, never hardcoded client-side — it grows on its own as the database grows, same as '
  'loader_active_platforms_ar() already does for the platform count on this same screen.';

select * from public.loader_scale_stats_ar();
