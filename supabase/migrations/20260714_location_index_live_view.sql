-- ─────────────────────────────────────────────────────────────────────────────────────────
-- LOCATION_INDEX REPOINT — retire the orphaned `location_index` MV, add `location_index_live`
--
-- ROOT CAUSE (investigated 2026-07-14, read-only, project aannarbkwcymrotzwdbo):
--   `ensureLocationIndex()` in src/data/locations.ts:539 is the ONLY live FE code path that reads
--   `public.location_index`. That MV is refreshed by NO cron job — `docs/ARCHITECTURE.md:378`
--   claims jobid 16 (`refresh-location-index`, daily 02:00) refreshes it, but jobid 16's actual
--   live command (`cron.job` jobid=16) is:
--     refresh materialized view concurrently public.listing_location_index;
--     refresh materialized view concurrently public.listing_location_canonical_mv;
--   — it never mentions `location_index`. `pg_stat_user_tables.last_autoanalyze` for
--   `location_index` = 2026-06-23 21:35:27 UTC (21 days stale as of 2026-07-14); the two MVs
--   jobid 16 actually refreshes both show `last_autoanalyze` = 2026-07-14 02:00:4x UTC (today).
--   A regex scan of every `cron.job.command` for `location_index` not preceded by `listing_`
--   returns zero rows — no job anywhere refreshes it.
--
-- FIX: point the FE at a plain (non-materialized) VIEW over the already-fresh
--   `listing_location_canonical_mv` instead of resurrecting `location_index` with a new cron job.
--   A plain view needs no schedule — it recomputes on every read from a matview that jobid 16 keeps
--   current, so this closes the staleness gap with zero new operational surface.
--
-- COLUMN CHOICE (verified 2026-07-14, corrects an earlier assumption in the investigation writeup
-- that a `city_ar`/`region_ar` column existed on the mv — it does not):
--   `listing_location_canonical_mv` has BOTH a canonicalized Arabic triple (`region`,`city`,`district`)
--   AND the as-scraped raw triple (`region_raw`,`city_raw`,`district_raw`). Verified by direct query:
--     city        is 100% Arabic  (185,379/185,379 searchable rows match [ء-ي], 0 match [a-zA-Z])
--     city_raw    is 100% English (185,523/186,643 rows match [a-zA-Z], 0 match [ء-ي])
--     region_raw  is 100% English (179,506/186,643 rows match [a-zA-Z], 0 match [ء-ي])
--     district_raw is mixed EN/AR (86,315 EN / 99,039 AR / 1,289 null) — same mixed character the
--       current `location_index.district` already has (2,711 EN / 3,187 AR out of 5,899 rows), because
--       some platforms (aqar) capture Arabic district text natively and others (wasalt, gathern, …)
--       capture English.
--   `src/data/locations.ts` keys EVERY downstream structure in ENGLISH: `CITY_TOKENS` (locations.ts
--   :various) maps aliases → English canonical strings ("Riyadh", "Jeddah", "Al Ahsa" …), and
--   `regionForCity()` (locations.ts:563-568) does `v.city.toLowerCase() === lc` against an English
--   `lc`. Swapping to the CANONICAL Arabic `city`/`region` columns would silently break every one of
--   those lookups (a same-shape column swap is NOT enough — the language/domain of the values has to
--   match too). Using `city_raw`/`region_raw`/`district_raw` preserves the exact same raw-English/
--   mixed-district semantics `location_index` already has today, sourced from the live matview instead
--   of the dead one. This view intentionally does NOT attempt the separate "Arabic-first autocomplete"
--   redesign — that would require rekeying CITY_TOKENS/CITIES_IDX to Arabic and is out of scope for a
--   pure repoint (tracked separately if wanted).
--
-- SCOPE CHANGE (disclosed, not hidden): `location_index` only ever unioned the ~33
-- `*_residential_listings` tables (residential-only). `listing_location_canonical_mv` covers BOTH
-- residential and commercial categories. This view does not filter on `category`, so it is a strict
-- superset of what `location_index` provided (185,379 searchable rows / 6,582 (region,city,district)
-- groups vs. location_index's 160,130 rows / 5,899 groups) — it can only make MORE real inventory
-- reachable via autocomplete/region lookup, never less. This matches the repo's existing PERMANENT
-- rule ("every category filters whole DB" — Reachability + Commercial fix, 2026-07-09). Flagging this
-- explicitly for reviewer sign-off since it is a behavior change beyond a pure rename, even though it
-- is a superset and low-risk by construction (no existing key's row set shrinks).
--
-- QUALITY GATE: `WHERE searchable` excludes the 1,264 rows where the resolver could not canonicalize
-- the city at all (`review_reason = 'city_unresolved'`); of those, 144 still had raw city text. This
-- mirrors the "quality gate location_index never had" benefit called out in the investigation.
--
-- NOT executed against the live project — this file is staged for review/merge only.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace view public.location_index_live as
select
  region_raw   as region,
  city_raw     as city,
  district_raw as district,
  count(*)     as n
from public.listing_location_canonical_mv
where searchable
  and city_raw is not null
group by region_raw, city_raw, district_raw;

comment on view public.location_index_live is
  'Read-time repoint target for src/data/locations.ts ensureLocationIndex() (was public.location_index, '
  'orphaned since 2026-06-23 — refreshed by no cron job). Sourced from listing_location_canonical_mv, '
  'which jobid 16 (refresh-location-index, daily 02:00) keeps current. Plain view, no matview, no new '
  'cron job needed. See 20260714_location_index_live_view.sql header for full rationale.';

-- No GRANT statement needed: verified via `pg_default_acl` (2026-07-14) that role `postgres` has a
-- default ACL on schema `public` granting anon/authenticated/service_role full relation privileges
-- (incl. SELECT) on every NEW table/view it creates — the same mechanism that already makes
-- `location_index` (and every other bare view/table) readable by the app's anon key today. A view
-- created by the same migration-runner role inherits this automatically.

-- Rollback if ever needed:
--   drop view if exists public.location_index_live;
--   -- and revert src/data/locations.ts ensureLocationIndex() back to .from('location_index')
