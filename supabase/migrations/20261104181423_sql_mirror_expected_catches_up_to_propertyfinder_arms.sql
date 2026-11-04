-- Regenerating a mirror is a TWO-PLACE edit (verify-mirror-md5-is-registered). The Property Finder launch wiring
-- (propertyfinder_launch_wiring_into_search, replayed unchanged by propertyfinder_launch_listing_location_index) rebuilt
-- listing_native_location_v1, so this row is caught up in the same change as the wiring, not after the drift alarm.
--
-- Two arms spliced after the haraj commercial arm, in the wiring rendering, and PROVEN equal to production: md5 of the
-- spliced text == md5(pg_get_viewdef(...,true)). 148,007 -> 149,342 chars.
update public.ops_sql_mirror_expected
   set expected_md5 = '14cd19d8345818bcdb4b9b9ff7591f81',
       recorded_at = now(),
       note = 'Regenerated 2026-11-04 after the Property Finder launch wiring. 148,007 -> 149,342 chars.'
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
  foreach t in array array['propertyfinder','haraj','shomou','maktab','superoffice','sirdab','arsh','holoul'] loop
    if position(t || '_commercial_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 0 then
      raise exception 'the % arm is not in the live view - refusing to register this digest', t;
    end if;
  end loop;
  raise notice 'ops_sql_mirror_expected now matches the live listing_native_location_v1 (%)', v_live;
end $verify$;