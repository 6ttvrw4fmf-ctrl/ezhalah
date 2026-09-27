-- Regenerating a mirror is a TWO-PLACE edit (verify-mirror-md5-is-registered). Five wiring passes
-- since wave 2 rebuilt listing_native_location_v1 -- wahadat (20260926094922), squares+rawaf
-- (20260926182020), vmksa+macsaib (20260926212517), maqrat (20260926231034), batch4 (20260926235957)
-- and wave 3b maqam+earthapp+nawafeth (20260927014059) -- and none moved this row or the mirror file,
-- so mon_detect_sql_mirror_drift has compared the live view against the wave-2 digest since 09-26
-- 09:49. Found by verify-sql-mirrors-not-stale when the wave-3b wiring post-dated the mirror date.
--
-- The new body was NOT re-downloaded: the 28 missing arms (14 platforms x residential+commercial)
-- were spliced after the nufouth commercial anchor in reverse-apply order, in the rendering the
-- wiring migrations use, and the result was PROVEN equal to production -- md5 of the spliced text
-- matched md5(pg_get_viewdef(...,true)) exactly. 111,322 -> 127,992 chars.
update public.ops_sql_mirror_expected
   set expected_md5 = 'c9fb60d0df760c109e4f524cb5902654',
       recorded_at = now(),
       note = 'Regenerated 2026-09-27 after wahadat, squares+rawaf, vmksa+macsaib, maqrat, batch4 and '
              || 'wave-3b (maqam, earthapp, nawafeth) wirings, none of which had moved this row. '
              || '111,322 -> 127,992 chars.'
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
  foreach t in array array['maqam','earthapp','nawafeth','opensooq','vmksa','wahadat','ibaax','tuba'] loop
    if position(t || '_commercial_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 0 then
      raise exception 'the % arm is not in the live view - refusing to register this digest', t;
    end if;
  end loop;
  raise notice 'ops_sql_mirror_expected now matches the live listing_native_location_v1 (%)', v_live;
end $verify$;
