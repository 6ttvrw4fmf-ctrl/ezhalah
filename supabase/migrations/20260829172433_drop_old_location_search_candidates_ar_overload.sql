-- URGENT fix, same-session: CREATE OR REPLACE with a new trailing parameter (p_rotation_seed) did
-- NOT replace the prior 41-arg function - Postgres treated the differing arg list as a NEW OVERLOAD
-- (oid 6484563), leaving the old 41-arg one (oid 5424858) live alongside it. This is exactly the
-- PGRST203 duplicate-overload outage shape (AGENTS.md "CREATE OR REPLACE overload hazard" /
-- "Migration drift guard" condition 4) - PostgREST can no longer resolve which overload a named-
-- parameter call means, and EVERY call omitting p_rotation_seed (i.e. every live caller right now)
-- started failing with "function ... is not unique" the instant the previous migration committed.
-- Drop the old signature immediately so exactly one overload remains.
drop function public.location_search_candidates_ar(
  p_deal text, p_cities text[], p_districts text[], p_tables text[], p_platforms text[],
  p_per_platform integer, p_limit integer, p_region_ids integer[], p_types text[],
  p_price_min numeric, p_price_max numeric, p_rent_period text, p_area_min integer, p_area_max integer,
  p_beds_exact integer[], p_beds_min integer, p_bath_min integer, p_furnished boolean, p_age_max integer,
  p_tenant text, p_directions text[], p_has_license boolean, p_amenities text[], p_offset integer,
  p_tables2 text[], p_types2 text[], p_age_min integer, p_bath_exact integer[], p_street_width_min smallint,
  p_street_width_max smallint, p_floor_min integer, p_floor_max integer, p_is_new_construction boolean,
  p_category text, p_sort_by text, p_age_unknown boolean, p_rating_min numeric, p_reviews_min integer,
  p_unit_subtypes text[], p_price_min_rent numeric, p_price_max_rent numeric
);
