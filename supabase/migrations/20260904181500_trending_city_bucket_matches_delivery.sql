-- A TRENDING CITY ROW MUST ADVERTISE WHAT CLICKING IT DELIVERS — AND A CLUSTER SHOWS ONE ROW.
--
-- THE CONTRACT. Two owner rules, both recorded in src/data/locations.ts:
--   · "Owner rule 2026-08-22: Trending IS the location breakdown of the user's eligible set."
--   · "owner rule 2026-08-22: the city count shown must equal what clicking that city returns,
--      under the full current AF state."
-- and the district twin at DistrictOption.totalInCity: "the % means 'share of what clicking the
-- CITY returns'" (owner, 2026-08-15).
--
-- REVISION HISTORY OF THIS FILE. It shipped once already as a two-row fix (both الهفوف/12 and
-- الاحساء/3677 correctly reporting the same 2,737-union count, still two Top-6 slots). The owner
-- has now decided the PRESENTATION question that PR left open, verbatim: "Do not allow two
-- Top-city positions to represent the same underlying eligible search cluster. The displayed
-- count must still equal the exact eligible set the user gets when clicking that row. Search
-- behavior and the existing location cluster semantics must not be weakened or changed just for
-- presentation." This revision REPLACES the two-row fix with a one-row-per-cluster collapse that
-- satisfies all three clauses at once — the two-row shape never reaches production.
--
-- THE DIVERGENCE THIS STILL FIXES. Since 20260831195108 re-populated loc_city_cluster
-- (owner-approved: «a Saudi user typing either reasonably expects the properties of that area» —
-- only findability widens, no listing relabelled), the RESULTS path delivers a row under city C
-- whenever C ∈ s.match_city_ids (composite_match_city_ids unions in every loc_city_cluster
-- sibling; location_search_candidates_ar ORs on `s.match_city_ids && (city_ids)`), but TRENDING
-- still bucketed on the scalar `group by co.city_id`. Measured live 2026-09-04, cohort
-- سكني · أرض سكنية · بيع: الهفوف (12) said 2,627, الاحساء (3677) said 110, clicking either
-- delivered 2,737.
--
-- THE COLLAPSE. A row's bucket is no longer "this city_id" but "the anchor city_id of whatever
-- cluster this city_id belongs to, or itself if it belongs to none" — computed once per element of
-- match_city_ids, then DISTINCTed, so a listing whose array is {12,3677} (both members of cluster
-- al_ahsa) contributes exactly ONE bucket, not two. `total` is still count(*) over the cohort, so
-- total_in_cohort does not move.
--
-- THE ANCHOR IS PARAMETERIZED, NOT CHOSEN HERE. `loc_city_cluster_anchor(cluster_key primary key,
-- anchor_city_id, note)` is the single, obvious knob. This migration creates the table EMPTY.
-- With no row for 'al_ahsa', `coalesce(anch.anchor_city_id, b.city_id)` falls through to
-- `b.city_id` for every element, so the two cities do NOT collapse — Trending keeps reporting the
-- one thing already proven safe (two rows, both the correct 2,737 union), exactly the prior
-- revision's shipped behaviour. The moment the owner names the anchor, the fix is:
--     insert into public.loc_city_cluster_anchor (cluster_key, anchor_city_id, note)
--     values ('al_ahsa', <12 or 3677>, 'owner decision <date>, docs/ARCHITECTURE.md §21');
-- one INSERT, no redeploy, no further design work — this is what ready_once_anchor_chosen means.
--
-- BLAST RADIUS, measured on all live rows: the ONLY multi-valued match_city_ids shape in the table
-- is {12,3677}; every other row's array is exactly its own city_id, so every other city row is
-- byte-identical before and after, with or without the anchor seeded. All NULL/empty-array rows
-- are production_ready = false and the coalesce keeps them mapped to their own city_id regardless
-- — an unknown array can never become no row.
--
-- NOT TOUCHED HERE: district_options_ar still scopes on `and s.city_id = p_city_id`, so the
-- district list and its totalInCity denominator carry the same understatement for these two
-- cities. Widening it needs a second answer — whether a clustered city's district CATALOG unions
-- its siblings' districts, or a sibling's district becomes an unreachable remainder. Reported, not
-- silently half-fixed. Also not touched: composite_match_city_ids(), trg_set_match_city_ids,
-- location_search_candidates_ar — the RESULTS path is untouched, which is exactly why clicking
-- either city_id still delivers the same union after this migration as before it.
--
-- Needle-edited from pg_get_functiondef of the LIVE function (37 params — retyping the signature
-- would create a new overload), with an exact occurrence COUNT asserted before each replacement.

create table if not exists public.loc_city_cluster_anchor (
  cluster_key    text primary key,
  anchor_city_id integer not null,
  note           text
);
comment on table public.loc_city_cluster_anchor is
  'The single knob for the Trending-collapse anchor (docs/ARCHITECTURE.md §21). One row per '
  'loc_city_cluster.cluster_key names which member city_id top_cities_by_deal_ar displays for the '
  'whole cluster. A cluster with NO row here does not collapse (top_cities_by_deal_ar falls back '
  'to per-city_id buckets) — empty on purpose until the owner names the anchor. Flipping or adding '
  'an anchor is a single INSERT/UPDATE; verify-trending-city-bucket-matches-delivery.ts pins that '
  'anchor_city_id is always an actual member of its own cluster_key.';

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
  repl2   text := E'  select disp.city_id, disp.city_ar, disp.region_id, r.region_ar,\n'
               || E'         count(*)::int as listing_count, total.t as total_in_cohort\n'
               || E'  from cohort co\n'
               || E'    cross join lateral (\n'
               || E'      select distinct coalesce(anch.anchor_city_id, b.city_id) as city_id\n'
               || E'      from unnest(coalesce(co.match_city_ids, array[co.city_id])) as b(city_id)\n'
               || E'      left join public.loc_city_cluster lcc on lcc.city_id = b.city_id\n'
               || E'      left join public.loc_city_cluster_anchor anch on anch.cluster_key = lcc.cluster_key\n'
               || E'    ) bk\n'
               || E'    join public.loc_catalog_city disp on disp.city_id = bk.city_id\n'
               || E'    left join public.loc_catalog_region r on r.region_id = disp.region_id\n'
               || E'    cross join total\n'
               || E'  group by disp.city_id, disp.city_ar, disp.region_id, r.region_ar, total.t\n';
begin
  d := pg_get_functiondef('public.top_cities_by_deal_ar'::regproc);

  -- Already applied? (re-run safe: the fix is present, nothing to do)
  if position(repl2 in d) > 0 then
    raise notice 'top_cities_by_deal_ar already buckets on the cluster-collapsed match_city_ids — no change';
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

  -- With no anchor row seeded, 12 and 3677 still each bucket to themselves (no collapse yet) —
  -- so this asserts the SAME invariant the prior revision proved: each reports the true union.
  if after_12 <> oracle_12 or after_3677 <> oracle_3677 then
    raise exception 'bucket still disagrees with delivery: 12 %/% , 3677 %/%', after_12, oracle_12, after_3677, oracle_3677;
  end if;
  if tot_after <> tot_before then
    raise exception 'total_in_cohort must not move: % -> %', tot_before, tot_after;
  end if;
  raise notice 'top_cities_by_deal_ar: 12 % -> % (delivers %), 3677 % -> % (delivers %), total_in_cohort % unchanged. No anchor seeded yet — cluster does not collapse until loc_city_cluster_anchor gets a row.',
    before_12, after_12, oracle_12, before_3677, after_3677, oracle_3677, tot_after;
end $$;
