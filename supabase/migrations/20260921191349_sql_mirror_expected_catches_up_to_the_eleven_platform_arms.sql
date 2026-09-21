-- ops_sql_mirror_expected catches up to listing_native_location_v1's new shape.
--
-- 20260921180100 added twenty-two arms to that matview (alsidra, moftah, masar, gomenassat, sakan,
-- bossbih, alshawaf, ialqarawi, aljassim, almotmkenah, nufouth — residential + commercial each),
-- right after the wslnaa commercial arm, so its definition genuinely changed:
-- 38,407 chars / md5 dcda0a5ff4fe7942c22bb8d37af5dca0 becomes 51,672 chars /
-- md5 024fa413d718ee03c6aa13af77894de7.
--
-- HOW THE NEW DIGEST WAS DERIVED without touching production: the rendered arm text was PROVEN on
-- the previous onboarding first — splicing the same arm rendering into the pre-#3320 body
-- reproduces #3320's live digest dcda0a5ff4fe7942c22bb8d37af5dca0 byte for byte — and then applied
-- to today's live body (md5-verified equal to sql/mirrors/listing_native_location_v1.sql). If v1
-- drifts before this lands, the verify below fails, which is the point: the mirror and this row
-- must then be regenerated from pg_get_viewdef, never re-dated.
--
-- Regenerating a mirror is a TWO-PLACE edit and verify-mirror-md5-is-registered enforces both
-- halves: sql/mirrors/listing_native_location_v1.sql carries the new body, and this migration
-- registers the same digest so the live drift detector compares against what production has.
update public.ops_sql_mirror_expected
   set expected_md5 = '024fa413d718ee03c6aa13af77894de7',
       recorded_at = now(),
       note = 'Regenerated 2026-09-21 after 20260921180100 added the alsidra/moftah/masar/gomenassat/'
              || 'sakan/bossbih/alshawaf/ialqarawi/aljassim/almotmkenah/nufouth arms (22 in total). '
              || '38,407 -> 51,672 chars.'
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
