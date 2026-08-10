-- Audit 2026-08-10, Issue #1: the "unlocated fallback" disjunct rescued LOCATED rows too.
--
-- The three read RPCs (location_search_candidates_ar, apartment_guided_counts_ar,
-- property_age_option_counts_ar) all carry the same row gate:
--
--   where (s.production_ready
--          or (<no city filter> and <no district filter> and p_region_ids is null
--              and not public.search_row_price_gated(s.deal_ar, s.price_total)))
--
-- Intent (product rule "unresolved-location countrywide"): a row whose location could NOT be
-- resolved still deserves to appear in a countrywide search, because no location filter could
-- ever reach it. Correct and deliberate — KEEP.
--
-- Defect: the fallback keys off "the USER supplied no location filter", not off "the ROW is
-- unlocated". production_ready is NOT a pure location gate — trigger enforce_price_size_sanity()
-- also clears it when price_size_impossible(price_total, price_annual, area_m2) is true (the
-- owner-approved PR#298 safety gate). So every impossible-value row that DID resolve a location
-- fell through this disjunct and became searchable — but only while no location filter was set.
--
-- Live evidence before this migration (production, 2026-08-10):
--   34 rows have region_id + city_id NOT NULL yet production_ready=false (all price/size-withheld).
--   dealapp/5696027 (جدة, city_id=18): price_total 22,002,786,078,000 SAR over 564,174 m²
--   — returned by location_search_candidates_ar(p_deal=>'بيع') with no location filter,
--     and NOT returned by the same call with p_cities=>ARRAY['جدة'].
--   Same row, same query, two different answers depending on an unrelated filter.
--
-- Fix: the fallback may only rescue rows that are genuinely unlocated. Located rows now behave
-- identically whether or not a location filter is present. This does NOT re-introduce any price
-- gate — search_row_price_gated() stays the neutralised no-op from PR#385, and the sub-1000 Buy
-- rule is untouched (those rows are production_ready=true and never depended on this disjunct).
--
-- Needle-edit against the LIVE function bodies (never a hand-retyped full-body replace, per the
-- CREATE-OR-REPLACE revert hazard): fetch pg_get_functiondef, assert the needle appears exactly
-- once, substitute, re-execute. Fails loudly if any function has drifted.
--
-- Regression barrier: scripts/verify-unlocated-fallback-scope.ts (wired into `npm test`) plus
-- monitor mon_located_row_visible_only_unfiltered (must stay 0 rows).

do $mig$
declare
  r            record;
  needle       constant text := 'not public.search_row_price_gated(s.deal_ar, s.price_total)';
  replacement  constant text := 'not public.search_row_price_gated(s.deal_ar, s.price_total) and (s.region_id is null or s.city_id is null)';
  body         text;
  hits         int;
  fixed        int := 0;
begin
  for r in
    select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname in ('location_search_candidates_ar',
                        'apartment_guided_counts_ar',
                        'property_age_option_counts_ar')
  loop
    body := pg_get_functiondef(r.oid);

    -- already patched (idempotent re-run)?
    if position(replacement in body) > 0 then
      continue;
    end if;

    hits := (length(body) - length(replace(body, needle, ''))) / length(needle);
    if hits <> 1 then
      raise exception
        'audit-2026-08-10: expected exactly 1 unlocated-fallback call site in %, found % — body drifted, refusing to patch blindly',
        r.sig, hits;
    end if;

    body := replace(body, needle, replacement);
    execute body;
    fixed := fixed + 1;
  end loop;

  if fixed = 0 then
    raise notice 'audit-2026-08-10: no functions needed patching (already applied)';
  end if;
end
$mig$;

-- Post-condition: every one of the three RPCs must now carry the unlocated guard.
do $verify$
declare missing text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
    into missing
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname in ('location_search_candidates_ar',
                      'apartment_guided_counts_ar',
                      'property_age_option_counts_ar')
    and pg_get_functiondef(p.oid) not like '%and (s.region_id is null or s.city_id is null)%';

  if missing is not null then
    raise exception 'audit-2026-08-10: unlocated guard missing after patch in: %', missing;
  end if;
end
$verify$;

-- Permanent monitor: a LOCATED row must never be visible only when no location filter is set.
-- Any row here means the fallback has regressed to rescuing located rows again.
create or replace view public.mon_located_row_visible_only_unfiltered as
  select s.source_table,
         s.listing_id,
         s.platform,
         s.city_ar,
         s.price_total,
         s.price_annual,
         s.area_m2
  from public.search_listings_ar s
  where s.region_id is not null
    and s.city_id is not null
    and not s.production_ready;

comment on view public.mon_located_row_visible_only_unfiltered is
  'Audit 2026-08-10 barrier. Rows that resolved a location but are withheld (price/size safety gate). '
  'These must be withheld CONSISTENTLY — never reachable via the unlocated-fallback disjunct in the '
  'read RPCs. The view lists the withheld population; the paired test asserts none of them are '
  'returned by location_search_candidates_ar with no location filter.';
