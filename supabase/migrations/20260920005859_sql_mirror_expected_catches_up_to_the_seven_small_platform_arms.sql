-- ops_sql_mirror_expected catches up to listing_native_location_v1's new shape.
--
-- 20260920002703 added fourteen arms to that matview (gudai, safera, alhumaidan, aqarnajran,
-- fahadalshahri, compoundin, wslnaa — residential + commercial each), so its definition genuinely
-- changed: 27,332 chars / md5 522c0705053f9b2f1806b83520061858 became 38,407 chars /
-- md5 dcda0a5ff4fe7942c22bb8d37af5dca0.
--
-- Regenerating a mirror is a TWO-PLACE edit and verify-mirror-md5-is-registered enforces both
-- halves: sql/mirrors/listing_native_location_v1.sql carries the new body (regenerated verbatim
-- from pg_get_viewdef, NOT re-dated — a blind re-date is what that guard's own header calls worse
-- than the failure it silences), and this migration registers the same digest so the live drift
-- detector compares against what production actually has.
update public.ops_sql_mirror_expected
   set expected_md5 = 'dcda0a5ff4fe7942c22bb8d37af5dca0',
       recorded_at = now(),
       note = 'Regenerated 2026-09-20 after 20260920002703 added the gudai/safera/alhumaidan/'
              || 'aqarnajran/fahadalshahri/compoundin/wslnaa arms (14 in total). 27,332 -> 38,407 chars.'
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
