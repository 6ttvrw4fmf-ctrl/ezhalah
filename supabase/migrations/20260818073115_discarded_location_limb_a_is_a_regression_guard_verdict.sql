-- Data Integrity run #29, verdict recorded on the function itself so it survives without this repo.
--
-- Proving limb A end to end surfaced something worth pinning: with listing_native_location_v2 as it
-- stands TODAY, limb A cannot fire on live data, and that is correct rather than broken.
--
-- The cohort predicate ("listings_arabic_locations resolves EXACTLY ONE canonical city, either by
-- name or within its own recorded region") is now the SAME rule as v2's own ulg / ulg2 fallbacks:
--   ulg   HAVING count(DISTINCT cc2.city_id) = 1                         == cohort branch (a)
--   ulg2  same, joined through loc_catalog_region on lal3.region_ar      == cohort branch (b)
-- and the third UNION branch (unresolved_catchall) reads listings_arabic_locations directly through
-- its lalc lateral. So for any listing PRESENT in v2, "lal resolves it" implies "v2 resolves it".
-- Discovered by measurement, not by reading: the first limb-A injection classified itself
-- sync_not_propagated because inserting the lal row fed v2's own catchall lateral — the injection
-- resolved the listing instead of stranding it.
--
-- Therefore limb A is a REGRESSION GUARD on the fallback chain: any nonzero count means someone
-- weakened ulg/ulg2/lalc or the listing_native_location_v1.best precedence — which is exactly the
-- run #26 defect (48 listings resolved-then-discarded, every count-parity check green throughout).
-- A permanent 0 here is the healthy reading, and it must never be "tidied away" as a dead limb.
--
-- Proven this run: limb B end to end through the real detector, both directions (fresh candidate
-- inside the 75 min grace -> no raise, ledger row written; same candidate aged past the grace ->
-- raised exactly once), injection rolled back; limb labelling proven for all three cases
-- (pipeline_discard / sync_not_propagated / not_in_v2); cost 3,614 ms -> 988 ms per sweep.

comment on function public.mon_detect_discarded_location_resolution() is
  'P1. Two limbs, settled by Data Integrity run #29 (2026-08-18). '
  'limb A pipeline_discard = listing_native_location_v2 itself yields no city while '
  'listings_arabic_locations resolves one unambiguously - raised IMMEDIATELY, no grace. Structurally '
  'this cannot fire while v2 keeps its ulg/ulg2/lalc fallbacks (they implement the same unambiguity '
  'rule as this cohort), so limb A is a REGRESSION GUARD on that chain and on '
  'listing_native_location_v1.best precedence - the run #26 defect. A standing 0 is the healthy '
  'reading; do not remove the limb because it is quiet. '
  'limb B sync_not_propagated = v2 has the city, search_listings_ar does not - raised only after '
  '75 min, because sync-search-listings-ar is hourly (jobid 28, :14) and the single-limb detector '
  'spent five windows of 2026-08-18 red on rows that were merely in flight (8, 53, 32, 6, 19 rows; '
  'every one cleared by the next sync). An always-red detector cannot raise the real thing: '
  'mon_raise() returns 0 on an open dedup key. '
  'Rows absent from v2 belong to mon_detect_orphaned_search_row and are excluded from both limbs. '
  'The cohort is evaluated ONCE per sweep into pg_temp._dlr_cohort: evaluating it per-limb cost '
  '3,614 ms vs 988 ms, and a detector that eats the roster budget protects nothing.';
