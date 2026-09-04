-- A TRENDING CITY ROW MUST ADVERTISE WHAT CLICKING IT DELIVERS.
--
-- THE CONTRACT. Two owner rules, both recorded in src/data/locations.ts:
--   · "Owner rule 2026-08-22: Trending IS the location breakdown of the user's eligible set."
--   · "owner rule 2026-08-22: the city count shown must equal what clicking that city returns,
--      under the full current AF state."
-- and the district twin at DistrictOption.totalInCity: "the % means 'share of what clicking the
-- CITY returns'" (owner, 2026-08-15).
--
-- THE DIVERGENCE. Since 20260831195108 re-populated loc_city_cluster (owner-approved: «a Saudi user
-- typing either reasonably expects the properties of that area» — only findability widens, no
-- listing is relabelled), two surfaces stopped agreeing:
--   · the RESULTS path delivers a row under city C when C ∈ s.match_city_ids (composite_match_city_ids
--     unions in every loc_city_cluster sibling; location_search_candidates_ar ORs on
--     `s.match_city_ids && (city_ids)`);
--   · TRENDING bucketed on the scalar `group by co.city_id`.
-- Measured on production 2026-09-04, cohort سكني · أرض سكنية · بيع, through the anon key:
--     الهفوف   (12)   Trending 2,627  · clicking delivers 2,737
--     الاحساء  (3677) Trending   110  · clicking delivers 2,737   ← the count is 4% of the truth
-- Under-promising is the safe direction, but 110 is not a description of 2,737, and a count surface
-- that describes nothing the user will see is not a count.
--
-- THE FIX. Bucket on the same array the results path filters on. `total` is still count(*) over the
-- cohort, so total_in_cohort stays the honest, un-doubled denominator.
--
-- BLAST RADIUS, measured on all 197,642 rows: the ONLY multi-valued match_city_ids shape in the
-- table is {12,3677} (5,955 rows, 3.0%); every other row's array is exactly its own city_id, so
-- every other city row is byte-identical before and after. All 469 rows with a NULL/empty array are
-- production_ready = false and were never in this cohort; the coalesce below keeps them mapped to
-- their own city_id anyway rather than dropping them, so an unknown array can never become no row.
--
-- DOUBLE COUNTING — DELIBERATE, AND THE OWNER MUST SEE IT. الهفوف and الاحساء now BOTH report 2,737
-- and both deliver the same 2,737 listings, so those rows no longer sum to total_in_cohort: in the
-- cohort above the sum goes 12,597 → 15,334 (121.7%) while total_in_cohort stays 12,597. Nothing in
-- the app renders a sum (the only denominator shown is total_in_cohort / totalInCity), so no
-- displayed percentage breaks. What IS user-visible: الاحساء climbs rank 16 → rank 2, so the Top-6
-- becomes الهفوف · الاحساء · الرياض · جدة · مكة المكرمة · حائل and المدينة المنورة (521) drops off —
-- two of six slots spent on one place under its two catalog names. Collapsing a cluster into ONE row
-- would fix that, but choosing which name to show is the catalog-duplicate display question
-- docs/ARCHITECTURE.md §21 records as "not yet decided; do not touch without owner answer". This
-- migration makes the numbers true and leaves that presentation question open.
--
-- NOT TOUCHED HERE: district_options_ar still scopes on `and s.city_id = p_city_id`, so the district
-- list and its totalInCity denominator carry the same understatement for these two cities (city 12
-- covers 2,627 of the 2,737 delivered; city 3677 covers 110). Widening it needs a second answer —
-- whether a clustered city's district CATALOG (`WHERE c.city_id = p_city_id`) unions its siblings'
-- districts, or listings from a sibling district become an unreachable remainder. Reported, not
-- silently half-fixed.
--
-- Needle-edited from pg_get_functiondef of the LIVE function (37 params — retyping the signature
-- would create a new overload), with an exact occurrence COUNT asserted before each replacement.
do $$
declare
  d text;
  occ int;
  before_12 int; before_3677 int; after_12 int; after_3677 int;
  oracle_12 int; oracle_3677 int; tot_before int; tot_after int;
  needle1 text := E'    select s.city_id\n    from public.search_listings_ar s\n';
  repl1   text := E'    select s.city_id, s.match_city_ids\n    from public.search_listings_ar s\n';
  needle2 text := E'  select co.city_id, c.city_ar, c.region_id, r.region_ar,\n'
               || E'         count(*)::int as listing_count, total.t as total_in_cohort\n'
               || E'  from cohort co\n'
               || E'    join public.loc_catalog_city c on c.city_id = co.city_id\n'
               || E'    left join public.loc_catalog_region r on r.region_id = c.region_id\n'
               || E'    cross join total\n'
               || E'  group by co.city_id, c.city_ar, c.region_id, r.region_ar, total.t\n';
  repl2   text := E'  select b.city_id, c.city_ar, c.region_id, r.region_ar,\n'
               || E'         count(*)::int as listing_count, total.t as total_in_cohort\n'
               || E'  from cohort co\n'
               || E'    cross join lateral unnest(coalesce(co.match_city_ids, array[co.city_id])) as b(city_id)\n'
               || E'    join public.loc_catalog_city c on c.city_id = b.city_id\n'
               || E'    left join public.loc_catalog_region r on r.region_id = c.region_id\n'
               || E'    cross join total\n'
               || E'  group by b.city_id, c.city_ar, c.region_id, r.region_ar, total.t\n';
begin
  d := pg_get_functiondef('public.top_cities_by_deal_ar'::regproc);

  -- Already applied? (re-run safe: the fix is present, nothing to do)
  if position(repl2 in d) > 0 then
    raise notice 'top_cities_by_deal_ar already buckets on match_city_ids — no change';
    return;
  end if;

  occ := (length(d) - length(replace(d, needle1, ''))) / length(needle1);
  if occ <> 1 then raise exception 'top_cities_by_deal_ar: expected 1 cohort select-list, found %', occ; end if;
  occ := (length(d) - length(replace(d, needle2, ''))) / length(needle2);
  if occ <> 1 then raise exception 'top_cities_by_deal_ar: expected 1 scalar city bucket, found %', occ; end if;

  select listing_count, total_in_cohort into before_12, tot_before
    from public.top_cities_by_deal_ar('بيع', null, 'Residential', array['أرض سكنية']) where city_id = 12;
  select listing_count into before_3677
    from public.top_cities_by_deal_ar('بيع', null, 'Residential', array['أرض سكنية']) where city_id = 3677;

  execute replace(replace(d, needle1, repl1), needle2, repl2);

  -- POST-CONDITION, against an INDEPENDENT count on the results path's own predicate.
  select count(*) into oracle_12 from public.search_listings_ar
   where production_ready and deal_ar = 'بيع' and type_ar = 'أرض سكنية' and match_city_ids @> array[12];
  select count(*) into oracle_3677 from public.search_listings_ar
   where production_ready and deal_ar = 'بيع' and type_ar = 'أرض سكنية' and match_city_ids @> array[3677];
  select listing_count, total_in_cohort into after_12, tot_after
    from public.top_cities_by_deal_ar('بيع', null, 'Residential', array['أرض سكنية']) where city_id = 12;
  select listing_count into after_3677
    from public.top_cities_by_deal_ar('بيع', null, 'Residential', array['أرض سكنية']) where city_id = 3677;

  if after_12 <> oracle_12 or after_3677 <> oracle_3677 then
    raise exception 'bucket still disagrees with delivery: 12 %/% , 3677 %/%', after_12, oracle_12, after_3677, oracle_3677;
  end if;
  if tot_after <> tot_before then
    raise exception 'total_in_cohort must not move: % -> %', tot_before, tot_after;
  end if;
  raise notice 'top_cities_by_deal_ar: 12 % -> % (delivers %), 3677 % -> % (delivers %), total_in_cohort % unchanged',
    before_12, after_12, oracle_12, before_3677, after_3677, oracle_3677, tot_after;
end $$;
