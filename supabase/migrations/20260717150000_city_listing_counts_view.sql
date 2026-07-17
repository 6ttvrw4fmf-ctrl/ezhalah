-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CITY LISTING COUNTS — canonical, live, per-city active-listing counts for the new City-only
-- Location field (owner spec 2026-07-17: "أي مدينة؟" field, Top-6-on-focus + Arabic autocomplete
-- while typing, cities-with-listings only, city_id-keyed to survive duplicate city names).
--
-- WHY GROUP BY city_id, NOT city_ar (verified live, 2026-07-17):
--   `search_listings_ar.city_ar` has real spelling-variant fragmentation in production — 482
--   distinct raw city_ar strings exist for a much smaller set of real cities (taa marbuta/haa and
--   alef-hamza endings, e.g. "مكة المكرمة"/"مكه المكرمه" — 6,698 + 747 rows — are the SAME city).
--   Grouping by the raw text either double-counts/undercounts affected cities or requires a live
--   normalize_ar() aggregate, which is correct but ~515ms (not indexed for this aggregate shape —
--   idx_slar_city_norm exists but the planner doesn't use it for a full-table GROUP BY).
--   `city_id` already collapses these variants correctly at ingestion (verified: both "مكة
--   المكرمة" and "مكه المكرمه" carry city_id=6) and is a plain indexed integer
--   (idx_slar_city_id), so `group by city_id` is BOTH correct and fast: 68ms live for the full
--   top-N aggregate (EXPLAIN ANALYZE, 2026-07-17), vs 515ms for the text-normalized equivalent.
--
-- WHY city_id ALSO MATTERS FOR DISAMBIGUATION (the owner's explicit spec requirement — "For
-- duplicate city names, use the confirmed hidden region internally so the wrong city is never
-- selected"): verified live that this is a REAL, current risk, not hypothetical — even restricted
-- to city_ids that have production listings, genuine duplicate city NAMES across DIFFERENT real
-- cities exist, e.g. "الهفوف" is city_id 12 in one region and city_id 501 in another, both with
-- live listings; same for "الباحة", "القاع", and 18 others found. A picker keyed on name text
-- alone could silently let a user select the wrong city. Exposing city_id + region_ar together
-- lets the client disambiguate (only needs to show the region qualifier when two results in the
-- same result set share a display name — most single-match results need no extra label).
--
-- WHY A PLAIN VIEW, NOT A MATERIALIZED ONE (the owner's brief said "preferably cached/precomputed"
-- — noting the tradeoff explicitly rather than silently picking one): `search_listings_ar` is kept
-- near-continuously in sync by sync_search_listings_ar() (unlike listing_location_canonical_mv,
-- which is a once-daily batch matview with a documented ~24h worst-case staleness gap — see
-- 20260714_proposed_canonical_mv_refresh_cadence.sql). Since the live grouped-by-city_id query is
-- already fast (68ms, well inside a page-mount budget) and this table changes throughout the day,
-- a materialized view here would trade that speed for a NEW staleness window with no offsetting
-- benefit. A plain view is itself a saved/precomputed query plan and always reflects the live
-- count. If real-world load ever makes 68ms too much at scale, this can be swapped for a
-- materialized view + cron refresh (matching the jobid 16/17 pattern) without changing the
-- read-side contract — the view name and column shape stay the same either way.
--
-- SCOPE: unfiltered by deal (Buy/Rent) or category (Residential/Commercial) — the owner's spec for
-- the City step doesn't mention scoping by either, and in the current Filter flow Location is
-- chosen BEFORE Category, so an unscoped citywide count is the only coherent choice at that point.
-- Only `production_ready = true` rows count (183,112 of 184,459 total rows as of 2026-07-17) —
-- this is the same predicate every other live-count feature in this app already gates on.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace view public.city_listing_counts_ar as
select
  s.city_id,
  c.city_ar,
  c.region_id,
  r.region_ar,
  count(*) as listing_count
from public.search_listings_ar s
join public.loc_catalog_city c on c.city_id = s.city_id
left join public.loc_catalog_region r on r.region_id = c.region_id
where s.production_ready = true
group by s.city_id, c.city_ar, c.region_id, r.region_ar;

comment on view public.city_listing_counts_ar is
  'One row per real city (grouped by loc_catalog_city.city_id, not raw city_ar text — the raw '
  'column has real spelling-variant duplicates in production). Backs the City-only Location field '
  '(src/data/locations.ts topCitiesByListings()/citiesWithListings()): the Top-6-on-focus list is '
  'the top 6 rows by listing_count, and the typed-autocomplete pool is every row here. city_id + '
  'region_ar are exposed together so the client can disambiguate genuine duplicate city names '
  '(confirmed live, e.g. الهفوف exists as two distinct real cities). No GRANT needed — verified '
  '2026-07-14 (see 20260714_location_index_live_view.sql) that role postgres has a default ACL on '
  'schema public granting anon/authenticated SELECT on every new view/table it creates.';

-- Rollback if ever needed:
--   drop view if exists public.city_listing_counts_ar;
