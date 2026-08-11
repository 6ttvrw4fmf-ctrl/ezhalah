-- P1 (senior audit run #10, 2026-08-11): clear seven manufactured-negative amenity columns on
-- wasalt, and stop the crawl re-creating them (scrapers/wasalt/run.py, same PR).
--
-- WHY THESE ARE NOT SOURCE-PUBLISHED NEGATIVES
-- scrapers/wasalt/run.py maps 13 feature-grid booleans out of wasalt's curated `featureAmenities`
-- list. Its existing rule — list absent -> None, list present -> True/False — is correct, but only
-- for a keyword the vocabulary is CAPABLE of containing. Measured over the entire wasalt corpus
-- (62,745 rows, active + inactive, all time):
--
--     parking  2,258 true / 11,023 false        elevator          0 true /   203 false
--     maid       1,285 / 11,996                 air_conditioner   0 / 203
--     laundry      828 / 12,453                 private_entrance  0 / 203
--     driver       739 / 12,542                 optical_fibers    0 / 203
--     balcony      658 / 12,623                 water_supply      0 / 203
--     kitchen       80 / 13,201                 electricity       0 / 203
--                                               sanitation        0 / 203
--
-- Two different populations. The six on the left are genuinely read — even `kitchen`, the rarest,
-- says "yes" 80 times. The seven on the right have NEVER been true once in 62,745 rows, and only
-- 203 rows carry any value at all: the 2026-08-05 repair NULLed them fleet-wide and every crawl
-- since has re-manufactured the same negative on whatever it touched (all 203 were written by the
-- 2026-08-11 00:40:22-00:42:06 list-crawl shards, runs 26912-26931). For those seven, `false` does
-- not mean "the property lacks it" — it means "this vocabulary cannot express it".
--
-- This is exactly the signature mon_safety_barrier_state exists to catch ("false with zero true
-- anywhere on the platform"), it caught it at the 03:23 snapshot, and it turned `npm test` red on
-- every open PR in the repo.
--
-- Nothing is lost: wasalt states water and electricity explicitly in its additionalAttributes
-- panel, captured separately and tri-state as separate_water_meter / separate_electricity_meter.
--
-- NULL is the honest value — the fact was never published, so an unknown is correct and a "no" is
-- not. Guarded by scripts/verify-wasalt-amenity-vocabulary.ts (wired into `npm test`), which fails
-- if any of the seven is mapped again without evidence the keyword can appear at all.
update public.wasalt_residential_listings
   set elevator = null, air_conditioner = null, private_entrance = null, optical_fibers = null,
       water_supply = null, electricity = null, sanitation = null
 where elevator is not null or air_conditioner is not null or private_entrance is not null
    or optical_fibers is not null or water_supply is not null or electricity is not null
    or sanitation is not null;

update public.wasalt_commercial_listings
   set elevator = null, air_conditioner = null, private_entrance = null, optical_fibers = null,
       water_supply = null, electricity = null, sanitation = null
 where elevator is not null or air_conditioner is not null or private_entrance is not null
    or optical_fibers is not null or water_supply is not null or electricity is not null
    or sanitation is not null;
