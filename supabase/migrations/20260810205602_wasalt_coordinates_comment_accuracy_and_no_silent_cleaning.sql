-- Correct the record on the previous migration, and state the actual policy.
--
-- 20260810..._wasalt_coordinates_correct_json_path described a Saudi bounds check
-- (lat 16..33, lon 34..56). The regexp_replace it ended up using swapped only the JSON PATH; the
-- BETWEEN guard from an earlier draft did not survive into the applied version. So the view stores
-- wasalt coordinates EXACTLY as published, with no plausibility gate. A comment promising a guard
-- that is not there is worse than no comment - the next engineer would trust it.
--
-- And on reflection storing them unfiltered is the CORRECT behaviour, not a bug to patch:
--   owner rule, 2026-08-10: "Do not clean source data because it looks strange.
--                            Source-backed strange value -> preserve it exactly."
-- Measured: 52,291 of 52,308 (99.97%) are plausible Saudi coordinates. 15 are null-island
-- (lat<1, lon<1) and 2 sit outside the country. Those 17 are what wasalt published; nulling them
-- would be us overruling the source on a hunch. No UI consumes coordinates yet, so nothing is
-- misled in the meantime, and whoever builds the map feature can decide how to treat them WITH the
-- source value still in hand — a decision that is impossible once the data is destroyed.
comment on view public.listing_rich_attrs is
  'Platform -> canonical RICH attribute mapping, from stored structured payloads only. '
  'wasalt coordinates come from ar_data->location->>lat/lon and are stored AS PUBLISHED - no '
  'plausibility gate (99.97% are plausible Saudi; 17 are not, and those 17 are the source''s values, '
  'not ours to erase). wasalt monthlyRentEMI is deliberately NOT mapped to installment_available: '
  'it is a finance calculator quote (rent x1.10/1.13/1.15 / 12), not a published offer. '
  'wasalt isApproxLocation (266 true) is a separate fact from the coordinates and still needs its '
  'own column - recorded as a known gap, never folded into the pin.';
