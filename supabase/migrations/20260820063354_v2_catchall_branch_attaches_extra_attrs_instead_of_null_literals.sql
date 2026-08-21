-- Senior Production Engineer run #32 (2026-08-20).
--
-- DEFECT. listing_native_location_v2's catch-all branch (source_method in lal_live_overlay /
-- lal_region_scoped_overlay / gathern_additional_info_overlay / unresolved_catchall) serves every
-- listing that listing_native_location_v1 could not resolve. It was written to satisfy the UNION's
-- column list with hardcoded NULL literals for all 14 advanced-filter attributes -- even though
-- listing_extra_attrs and listing_age_resolved already hold real, canonical, source-captured values
-- for those very rows, keyed identically. The v1 branch LEFT JOINs both tables; the catch-all branch
-- threw them away. Same platform, same field, different answer depending only on which branch served
-- the row: 153/153 fresh gathern rows have elevator/parking/driver_room in listing_extra_attrs, but
-- only 62 reached v2 -- and therefore search_listings_ar, and therefore the Advanced Filter.
--
-- 170 production_ready gathern listings were served to users with NULL amenities the database
-- already held, unreachable by the elevator / parking / driver_room filters. This is the
-- silently-dropped-supported-source-data class (AGENTS.md; routine sections 10, 17, 19).
--
-- SAME CLASS, SAME REMEDY as 20260717_v2_souq24_branches_attach_age_resolved, which fixed the
-- souq24 branches' hardcoded NULL::smallint AS property_age the same way.
--
-- FIX. In the catch-all branch ONLY, replace the 14 NULL literals with LEFT JOINs to
-- listing_extra_attrs (cea) and listing_age_resolved (car) on the branch's own key
-- (a.source_table, a.listing_id). Both tables are unique on that key (verified: 0 duplicate groups
-- in each), so the joins are cardinality-safe. Every other branch and every other column is
-- untouched; the column signature is unchanged, so CREATE OR REPLACE applies with no DROP CASCADE
-- and the search-sync dependency is undisturbed.
--
-- Applied as a GUARDED NEEDLE-EDIT, not a hand-transcribed body: the live definition is read with
-- pg_get_viewdef, both anchors are asserted to appear EXACTLY once, and the edit is refused
-- otherwise. Hand-copying a 12,439-character 5-branch view is precisely the failure mode this repo
-- has been bitten by.
--
-- VERIFIED against a test view BEFORE applying (test vs live, same snapshot):
--   196,004 rows both sides; 0 rows only-on-either-side
--   0 diffs on any NON-target column (platform, location, price, area, beds, baths, period, ...)
--   457 target diffs, ALL inside the catch-all branch (0 outside it)
--   0 rows where an existing non-NULL value was overwritten -- the change only fills NULLs
--   gains: elevator 187, parking 187, driver_room 187, street_width 257, license 204, direction 194,
--          property_age 74, kitchen 9, air_conditioner 5, maid_room 2; losses: 0 in every field

do $$
declare
  v_def text; v_new text; v_block_old text; v_block_new text; v_from_old text; v_from_new text;
begin
  select pg_get_viewdef(c.oid, true) into v_def
    from pg_class c where c.relname = 'listing_native_location_v2';

  v_block_old :=
'    NULL::boolean AS furnished,
    NULL::smallint AS property_age,
    NULL::text AS direction,
    NULL::smallint AS street_width_m,
    NULL::integer AS floor_number,
    NULL::text AS tenant_category,
    NULL::text AS license_number,
    NULL::boolean AS elevator,
    NULL::boolean AS parking,
    NULL::boolean AS kitchen,
    NULL::boolean AS air_conditioner,
    NULL::boolean AS maid_room,
    NULL::boolean AS driver_room,
    NULL::boolean AS private_entrance';

  v_block_new :=
'    cea.furnished,
    car.property_age,
    cea.direction,
    cea.street_width_m,
    cea.floor_number,
    cea.tenant_category,
    cea.license_number,
    cea.elevator,
    cea.parking,
    cea.kitchen,
    cea.air_conditioner,
    cea.maid_room,
    cea.driver_room,
    cea.private_entrance';

  v_from_old := '   FROM active_listing_ids_v2 a
';
  v_from_new := '   FROM active_listing_ids_v2 a
     LEFT JOIN listing_extra_attrs cea ON cea.source_table = a.source_table AND cea.listing_id = a.listing_id
     LEFT JOIN listing_age_resolved car ON car.source_table = a.source_table AND car.listing_id = a.listing_id
';

  if (length(v_def) - length(replace(v_def, v_block_old, ''))) / length(v_block_old) <> 1 then
    raise exception 'REFUSED: catch-all NULL attribute block not found exactly once';
  end if;
  if (length(v_def) - length(replace(v_def, v_from_old, ''))) / length(v_from_old) <> 1 then
    raise exception 'REFUSED: catch-all FROM anchor not found exactly once';
  end if;

  v_new := replace(replace(v_def, v_block_old, v_block_new), v_from_old, v_from_new);
  if v_new = v_def then raise exception 'REFUSED: needle-edit produced no change'; end if;

  execute 'create or replace view public.listing_native_location_v2 as ' || v_new;
end $$;

drop view if exists public.listing_native_location_v2_test;
