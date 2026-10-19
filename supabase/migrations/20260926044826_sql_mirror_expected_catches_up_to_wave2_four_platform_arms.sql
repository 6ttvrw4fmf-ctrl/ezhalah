-- ops_sql_mirror_expected catches up to listing_native_location_v1's new shape.
--
-- 20260926042615 added eight arms to that matview (ibaax, remaxsa, qmra, alajlan — residential +
-- commercial each), right after the nufouth commercial arm, so its definition genuinely changed:
-- 106,642 chars / md5 57e2a412b53db5c479f67c29789d1601 becomes 111,322 chars / md5 c7ffdce9a6763a5c99593788a37a7068.
--
-- Regenerating a mirror is a TWO-PLACE edit and verify-mirror-md5-is-registered enforces both
-- halves: sql/mirrors/listing_native_location_v1.sql carries the new body, and this migration
-- registers the same digest so the live drift detector compares against what production has.
update public.ops_sql_mirror_expected
   set expected_md5 = 'c7ffdce9a6763a5c99593788a37a7068',
       recorded_at = now(),
       note = 'Regenerated 2026-09-26 after 20260926042615 added the wave-2-four arms '
              || '(ibaax, remaxsa, qmra, alajlan, residential+commercial). 106,642 -> 111,322 chars.'
 where object_name = 'listing_native_location_v1';

do $verify$
declare v_md5 text; v_live text;
begin
  select expected_md5 into strict v_md5
    from public.ops_sql_mirror_expected where object_name = 'listing_native_location_v1';
  select md5(pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) into v_live;
  if v_md5 <> v_live then
    raise exception 'registered digest % does not match the LIVE object %', v_md5, v_live;
  end if;
  raise notice 'ops_sql_mirror_expected now matches the live listing_native_location_v1 (%)', v_live;
end $verify$;