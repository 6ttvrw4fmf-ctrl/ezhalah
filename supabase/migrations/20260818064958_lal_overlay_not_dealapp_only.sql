-- RESOLVED AND DISCARDED, again — 19 listings that Ezhalah had already located were unreachable by
-- EVERY Filter combination. Raised as P1 discarded_location_resolution 2026-08-18 06:29.
--
-- ROOT CAUSE. listing_native_location_v2's final catch-all branch handles active listings that are
-- not (yet) in the listing_native_location_v1 materialized view. It resolves a city from two
-- overlays: `lalc` (read listings_arabic_locations, our own resolution table) and `gth` (gathern's
-- additional_info). The lalc overlay carried a hardcoded platform allowlist:
--
--     AND (a.source_table = ANY (ARRAY['dealapp_residential_listings','dealapp_commercial_listings']))
--
-- so the generic "we already resolved this listing" fallback fired for dealapp and NOBODY ELSE.
-- Any other platform landing in the catch-all had its own matched=true resolution ignored, ending at
-- city_id NULL -> production_ready=false -> invisible to every Filter combination, while
-- listings_arabic_locations held a clean, unambiguous canonical city all along. Verified on four
-- samples: mustqr 8483144 «حائل» (city_id 10), ramzalqasim 8484023 «عنيزة» (80), aqarcity 8486628
-- «الرياض» (3), gathern 8490071 «الدمام» (13) — each matched=true, each resolving to EXACTLY ONE
-- catalog city, each returning city_id NULL from the view.
--
-- FIX. Remove the platform allowlist. Nothing else changes:
--   * the unambiguity gate `HAVING count(DISTINCT lc.city_id) = 1` is UNTOUCHED, so a name that is
--     ambiguous in the catalog still resolves to NULL, exactly as the detector demands;
--   * `l.matched IS TRUE AND l.city_ar IS NOT NULL` is untouched — unmatched rows stay unresolved;
--   * no city or district is written onto any listing table, and no catalog row is added. This does
--     not touch the Region -> City -> District hierarchy; it stops discarding a resolution we had.
--
-- MEASURED BLAST RADIUS, before applying: exactly 19 listings gain a city — aqarcity 8, mustqr 6,
-- gathern 4, ramzalqasim 1 — matching the detector's count of 19. Every other row in the catch-all
-- (abeea, raghdan, fursaghyr, aqaratikom, eastabha, erapulse, and the rest of gathern/aqarcity)
-- has no unambiguous resolution and correctly stays NULL. No listing loses its city.
--
-- Applied as a guarded NEEDLE-EDIT on the live pg_get_viewdef text: this view feeds the search index
-- for all ~195k listings, so nothing is retyped and only the allowlist predicate is removed. The
-- migration aborts if the needle is not found exactly once, if any listing LOSES production_ready,
-- or if the change is not exactly the 19 expected rows.

do $$
declare
  v_src text; v_new text; v_hits int;
  needle constant text :=
    '(a.source_table = ANY (ARRAY[''dealapp_residential_listings''::text, ''dealapp_commercial_listings''::text])) AND l.matched IS TRUE';
  replacement constant text := 'l.matched IS TRUE';
  v_before_ready bigint; v_before_total bigint;
  v_after_ready bigint; v_after_total bigint;
  v_lost bigint; v_gained bigint;
begin
  select pg_get_viewdef('public.listing_native_location_v2'::regclass, true) into v_src;

  select count(*) into v_hits from regexp_matches(v_src,
    '\(a\.source_table = ANY \(ARRAY\[''dealapp_residential_listings''::text, ''dealapp_commercial_listings''::text\]\)\) AND l\.matched IS TRUE', 'g');
  if v_hits <> 1 then
    raise exception 'expected exactly 1 occurrence of the dealapp allowlist needle, found % — refusing to edit blind', v_hits;
  end if;

  -- snapshot the exact production_ready set before the change
  create temp table _pr_before on commit drop as
    select source_table, listing_id from public.listing_native_location_v2 where production_ready;
  select count(*) into v_before_ready from _pr_before;
  select count(*) into v_before_total from public.listing_native_location_v2;

  v_new := replace(v_src, needle, replacement);
  if v_new = v_src then raise exception 'replacement was a no-op'; end if;

  execute 'create or replace view public.listing_native_location_v2 as ' || v_new;

  create temp table _pr_after on commit drop as
    select source_table, listing_id from public.listing_native_location_v2 where production_ready;
  select count(*) into v_after_ready from _pr_after;
  select count(*) into v_after_total from public.listing_native_location_v2;

  -- NOTHING may lose its city: this fix is strictly additive.
  select count(*) into v_lost from (
    select source_table, listing_id from _pr_before
    except select source_table, listing_id from _pr_after) z;
  if v_lost <> 0 then
    raise exception '% listings LOST production_ready — refusing', v_lost;
  end if;

  select count(*) into v_gained from (
    select source_table, listing_id from _pr_after
    except select source_table, listing_id from _pr_before) z;
  if v_gained <> 19 then
    raise exception 'expected exactly 19 newly resolvable listings, got % — blast radius not as measured', v_gained;
  end if;

  -- the view must still describe the same population overall
  if v_after_total <> v_before_total then
    raise exception 'row count changed from % to % — the edit altered the population, not just resolution',
      v_before_total, v_after_total;
  end if;

  raise notice 'production_ready % -> % (+%), total rows % unchanged',
    v_before_ready, v_after_ready, v_gained, v_after_total;
end $$;

-- The unambiguity gate must still be in force, and the allowlist must be gone.
do $$
declare v text;
begin
  select pg_get_viewdef('public.listing_native_location_v2'::regclass, true) into v;
  if position('dealapp_residential_listings''::text, ''dealapp_commercial_listings' in v) > 0
     and position('AND l.matched IS TRUE AND l.city_ar IS NOT NULL' in v) = 0 then
    raise exception 'allowlist still present on the lal overlay';
  end if;
  if position('HAVING count(DISTINCT lc.city_id) = 1' in v) = 0 then
    raise exception 'the unambiguity gate was lost — that gate must never be relaxed';
  end if;
  if position('l.matched IS TRUE' in v) = 0 then
    raise exception 'the matched=true gate was lost';
  end if;
end $$;
