-- Regenerating a mirror is a TWO-PLACE edit (verify-mirror-md5-is-registered). The five-source launch wiring rebuilt
-- listing_native_location_v1 twice (the Keller Williams + Almajdiah wiring, then Asas Makeen + Al Rajhi + STeam
-- 20261105111002; both replayed by their listing_location_index step), so this row is caught up in the same change as
-- the wiring, not after the drift alarm. ONE registration for all five (agreed between the two launch sessions).
--
-- Ten arms spliced after the propertyfinder commercial arm, in the wiring rendering, and PROVEN equal to production:
-- md5 of the spliced text == md5(pg_get_viewdef(...,true)). 149,342 -> 155,497 chars.
update public.ops_sql_mirror_expected
   set expected_md5 = '2af9ead54b06f713aa85e08b0e9eaf00',
       recorded_at = now(),
       note = 'Regenerated 2026-11-05 after the five-source launch wiring (KW, Almajdiah, Asas Makeen, Al Rajhi, STeam). 149,342 -> 155,497 chars.'
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
  foreach t in array array['kellerwilliams','almajdiah','asasmakeen','mrajhi','steam','propertyfinder','haraj','shomou','maktab'] loop
    if position(t || '_commercial_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 0 then
      raise exception 'the % arm is not in the live view - refusing to register this digest', t;
    end if;
  end loop;
  raise notice 'ops_sql_mirror_expected now matches the live listing_native_location_v1 (%)', v_live;
end $verify$;
