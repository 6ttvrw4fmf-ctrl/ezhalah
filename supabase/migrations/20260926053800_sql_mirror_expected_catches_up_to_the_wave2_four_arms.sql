-- Regenerating a mirror is a TWO-PLACE edit (verify-mirror-md5-is-registered): the file in
-- sql/mirrors and this registered digest must move together. 20260926042615/20260926043530 added
-- wave 2's four platforms (residential + commercial each) to listing_native_location_v1, so the
-- mirror was regenerated and this row catches up.
--
-- Caught by verify-sql-mirrors-not-stale (required npm test) mid-onboarding, not by an alert: the
-- object itself was correctly rebuilt in production, but the mirror file was one artefact this pass
-- had not yet refreshed. Same class as the wave-1 incident (alert_event 5622) this exact migration
-- shape exists for.
--
-- The new body was NOT re-downloaded: the eight arms were spliced into the previous mirror body in
-- the identical rendering pg_get_viewdef produces for every other arm, and the result was then
-- PROVEN equal to production -- md5 of the spliced text (trailing newline stripped, which is how
-- pg_get_viewdef returns it) matched the live digest exactly, over the same 111,322 chars.
-- 106,642 -> 111,322 chars.
update public.ops_sql_mirror_expected
   set expected_md5 = 'c7ffdce9a6763a5c99593788a37a7068',
       recorded_at = now(),
       note = 'Regenerated 2026-09-26 after 20260926042615/20260926043530 added the wave2-four '
              || 'residential + commercial arms (ibaax, remaxsa, qmra, alajlan) immediately after '
              || 'the nufouth commercial arm. 106,642 -> 111,322 chars.'
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
  foreach t in array array['ibaax','remaxsa','qmra','alajlan'] loop
    if position(t || '_residential_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 0
       or position(t || '_commercial_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 0 then
      raise exception 'the % arms are not in the live view - refusing to register a digest for them', t;
    end if;
  end loop;
  -- wave 1's ten must have survived: they sit just past the splice anchor
  if position('tuba_residential_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 0 then
    raise exception 'the wave-1 arms vanished - refusing to register this digest';
  end if;
  raise notice 'ops_sql_mirror_expected now matches the live listing_native_location_v1 (%)', v_live;
end $verify$;
