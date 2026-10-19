-- Regenerating a mirror is a TWO-PLACE edit (verify-mirror-md5-is-registered). batch5's wiring
-- (20260927021406: holoul, eightfloor, manzo) rebuilt listing_native_location_v1 on the SAME DAY as the
-- 20260927015240 catch-up, so verify-sql-mirrors-not-stale (date granularity) stayed green while the
-- mirror file and this row fell behind again -- the exact same-day trap that catch-up documented.
--
-- Six arms spliced after the nufouth commercial anchor (before maqam), in the wiring rendering, and
-- PROVEN equal to production: md5 of the spliced text == md5(pg_get_viewdef(...,true)).
-- 127,992 -> 131,577 chars.
update public.ops_sql_mirror_expected
   set expected_md5 = '6933a8725df7ea9007e04af125a58982',
       recorded_at = now(),
       note = 'Regenerated 2026-09-27 after batch5 (holoul, eightfloor, manzo) wiring. 127,992 -> 131,577 chars.'
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
  foreach t in array array['holoul','eightfloor','manzo','maqam','nawafeth'] loop
    if position(t || '_commercial_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 0 then
      raise exception 'the % arm is not in the live view - refusing to register this digest', t;
    end if;
  end loop;
  raise notice 'ops_sql_mirror_expected now matches the live listing_native_location_v1 (%)', v_live;
end $verify$;
