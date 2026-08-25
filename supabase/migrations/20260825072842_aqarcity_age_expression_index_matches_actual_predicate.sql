-- ROOT CAUSE of jobid 22's recurring 120s timeout, and of both aqarcity loc_rel
-- refreshes never once completing.
--
-- Migration 20260809112756 fixed exactly this failure shape fleet-wide: the
-- listing_age_resolved arm filters on an opaque IMMUTABLE function, the planner has no
-- statistics for it, estimates rows=1, picks a Nested Loop and re-evaluates
-- age_from_text_ar() once per outer row. It built ix_lra_<table> on
--     age_from_text_ar(additional_info ->> 'property_age_text')  WHERE active
-- for every platform table, and measured 126x on dealapp_commercial.
--
-- THAT FIX IS SILENTLY DEFEATED FOR aqarcity. listing_age_resolved reads
-- 'property_age_text' in 18 of its arms but 'property_age' -- a DIFFERENT JSON key -- in
-- the 2 aqarcity arms. The ix_lra_aqarcity_* indexes therefore do not match the
-- predicate and never will. They still exist, are still maintained on every write, and
-- still make the fix LOOK present: the index is even chosen in the plan, but only for
-- its `WHERE active` partial clause, never for the age expression. The measured result:
--
--   EXPLAIN on listing_native_location_v2 for 20 aqarcity_residential ids
--     Nested Loop Left Join  Join Filter: (listing_id = v1.listing_id)
--     Rows Removed by Join Filter: 2,512,684        <-- 1,768 x 1,422
--     ... and the same shape a second time in the Append: 2,653,452 more
--
--   Per-row cost of a v2 lookup, measured today, same 20-row shape:
--     aqarcity_residential  6,500 ms   (341 ms/row)
--     sanadak_residential      63 ms
--     raghdan_residential      55 ms
--     mustqr_residential       54 ms
--
-- 100x the fleet. That is why 1,768 dirty rows can never be refreshed inside the
-- ambient 120s statement_timeout, why last_status has read 'running' forever, and why
-- 238 aqarcity rows have never reached loc_rel_processed.
--
-- This is a PURE PLAN FIX: an index cannot change a returned row. Nothing about the
-- data, the view, the refresh logic, or any timeout changes -- verified by row-count
-- parity on listing_native_location_v2 for both tables before and after.
--
-- The lesson worth keeping: an index that no longer matches its predicate is
-- indistinguishable, from every dashboard and every index list, from one that does.
-- When a view's expression changes, the indexes built FOR that expression must be
-- re-derived, not assumed. mon_detect_loc_rel_table_never_completes() (added in the
-- same run) is what turns the next occurrence into a P1 instead of silence.

create index if not exists ix_lra_aqarcity_residential_listings_property_age
  on public.aqarcity_residential_listings
     (age_from_text_ar((additional_info ->> 'property_age'::text)))
  where active;

create index if not exists ix_lra_aqarcity_commercial_listings_property_age
  on public.aqarcity_commercial_listings
     (age_from_text_ar((additional_info ->> 'property_age'::text)))
  where active;

analyze public.aqarcity_residential_listings;
analyze public.aqarcity_commercial_listings;

comment on index public.ix_lra_aqarcity_residential_listings_property_age is
  'Statistics + index scan for listing_age_resolved''s aqarcity arm, which reads the '
  '''property_age'' key while the fleet-wide ix_lra_* indexes (20260809112756) cover '
  '''property_age_text''. Without this the v2 lookup costs ~341 ms/row vs ~3 ms/row '
  'elsewhere and jobid 22 dies at the 120s ceiling. Do not drop without re-checking '
  'which key listing_age_resolved actually filters on.';
