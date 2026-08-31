-- الأحساء / الهفوف: make each name find the other, WITHOUT relabelling a single listing.
-- Owner-approved 2026-08-31 after the investigation recorded in docs/ops/DERIVED_STORE_FRESHNESS.md
-- and the daily report.
--
-- THE PROBLEM. Both are real catalog cities — الاحساء (3677) and الهفوف (12), both in the Eastern
-- Province — and the SOURCE ITSELF publishes both: of aqar's active rows, 496 say «الاحساء» and 461
-- say «الهفوف». There are ZERO aliases between them, so the two searches returned disjoint sets:
-- 894 listings under الاحساء, 1,140 under الهفوف, and neither visible to the other. Al-Ahsa is the
-- governorate/oasis, Al-Hofuf its principal city; a Saudi user typing either reasonably expects the
-- properties of that area.
--
-- WHY NOT RELABEL. Rewriting one name to the other would destroy source truth on up to ~1,000
-- listings and arbitrarily pick a winner between two names the source uses deliberately. It would
-- also be irreversible without re-scraping. §6 says a confident match becomes a canonical ID and
-- anything ambiguous stays as published — it does not say pick one.
--
-- WHY THIS IS SAFE AND SMALL. The mechanism was already built end to end and simply never used:
--   * loc_city_cluster (city_id, cluster_key, note) existed and was EMPTY;
--   * composite_match_city_ids() already contains a CLUSTER EXPANSION branch that unions in every
--     sibling sharing a cluster_key;
--   * trigger set_match_city_ids fires BEFORE INSERT OR UPDATE on search_listings_ar;
--   * location_search_candidates_ar already ORs on `s.match_city_ids && (city_ids)`.
-- So this migration adds DATA to one empty table and re-triggers the affected rows. No function,
-- view, RPC or listing field is modified. Every listing keeps the exact city its source published;
-- only findability widens.
--
-- SCOPE. Deliberately just these two. المبرز (2748, the twin city inside the same governorate) is
-- NOT included — it is a defensible extension but was not part of the approved recommendation, so
-- it stays an open question rather than a silent widening. The duplicate «الهفوف» at city_id 501
-- (region 1, Riyadh — 0 listings) is likewise untouched: it is a catalog defect to be fixed on its
-- own terms, not folded into a search-behaviour change.

insert into public.loc_city_cluster (city_id, cluster_key, note) values
  (3677, 'al_ahsa', 'الاحساء — governorate/oasis name; the source publishes it as a city for ~496 aqar rows'),
  (12,   'al_ahsa', 'الهفوف — principal city of Al-Ahsa; the source publishes it for ~461 aqar rows')
on conflict do nothing;

-- Re-trigger only the affected rows so the BEFORE trigger recomputes match_city_ids for them.
-- Touching updated_at is not possible here (no such column); assigning city_id to itself is a
-- no-op write that fires the trigger and changes no stored value.
update public.search_listings_ar set city_id = city_id where city_id in (3677, 12);
