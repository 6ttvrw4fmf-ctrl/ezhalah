-- Regenerating a mirror is a TWO-PLACE edit (verify-mirror-md5-is-registered). batch6's wiring
-- (20260927034721: arsh) rebuilt listing_native_location_v1 on the SAME DAY as the batch-5 catch-up
-- (20260927032439), so this row is caught up in the same PR as the wiring, not after the drift alarm.
--
-- Two arms spliced after the nufouth commercial anchor (before holoul), in the wiring rendering, and
-- PROVEN equal to production: md5 of the spliced text == md5(pg_get_viewdef(...,true)).
-- 131,577 -> 132,712 chars.
update public.ops_sql_mirror_expected
   set expected_md5 = 'a54da52cab72eb2ae85924fe4c4cfa50',
       recorded_at = now(),
       note = 'Regenerated 2026-09-27 after batch6 (arsh) wiring. 131,577 -> 132,712 chars.'
 where object_name = 'listing_native_location_v1';

do $verify$
declare v_md5 text; v_live text; t text;
begin
  select expected_md5 into strict v_md5
    from public.ops_sql_mirror_expected where object_name = 'listing_native_location_v1';
  select md5(pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) into v_live;
  if v_md5 <> v_live then
    raise exception 'registered digest % does not match the LIVE object %', v_md5, v_live;
  end if;
  foreach t in array array['arsh','holoul','eightfloor','manzo','maqam','nawafeth'] loop
    if position(t || '_commercial_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 0 then
      raise exception 'the % arm is not in the live view - refusing to register this digest', t;
    end if;
  end loop;
  raise notice 'ops_sql_mirror_expected now matches the live listing_native_location_v1 (%)', v_live;
end $verify$;