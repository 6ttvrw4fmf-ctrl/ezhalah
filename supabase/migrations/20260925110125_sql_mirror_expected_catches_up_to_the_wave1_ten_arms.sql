-- Regenerating a mirror is a TWO-PLACE edit (verify-mirror-md5-is-registered): the file in
-- sql/mirrors and this registered digest must move together. 20260925081236 added wave 1's ten
-- platforms (residential + commercial each) to listing_native_location_v1, so the mirror was
-- regenerated and this row catches up.
--
-- alert_event 5622 (sql_mirror_drift, P1) fired 2026-09-25 08:29 naming exactly this object:
-- live 57e2a412b53db5c479f67c29789d1601 vs registered 6a0c034c408d43d3f179bafef7f97a55. The cause
-- was that 20260925081236 rebuilt the matview in production at 08:12 and was never committed, so
-- both its migration file and this mirror were missing. One unmirrored apply, two stale artefacts.
--
-- The new body was NOT re-downloaded: the twenty arms were spliced into the previous mirror body in
-- the identical rendering pg_get_viewdef produces for every other arm, and the result was then
-- PROVEN equal to production -- md5 of the spliced text (trailing newline stripped, which is how
-- pg_get_viewdef returns it) matched the live digest exactly, over the same 106,642 chars.
-- 94,952 -> 106,642 chars.
update public.ops_sql_mirror_expected
   set expected_md5 = '57e2a412b53db5c479f67c29789d1601',
       recorded_at = now(),
       note = 'Regenerated 2026-09-25 after 20260925081236 added the wave1-ten residential + '
              || 'commercial arms (alsaedan, ego, muhaysini, nofodh, razre, reinvest, safa, sokok, '
              || 'sukna, tuba) immediately after the nufouth commercial arm. 94,952 -> 106,642 chars.'
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
  -- and the arms this change is about must actually be in there
  foreach t in array array['alsaedan','ego','muhaysini','nofodh','razre',
                           'reinvest','safa','sokok','sukna','tuba'] loop
    if position(t || '_residential_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 0
       or position(t || '_commercial_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 0 then
      raise exception 'the % arms are not in the live view - refusing to register a digest for them', t;
    end if;
  end loop;
  -- abaad must have survived: it sits just past the splice anchor
  if position('abaad_residential_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 0 then
    raise exception 'the abaad arm vanished - refusing to register this digest';
  end if;
  raise notice 'ops_sql_mirror_expected now matches the live listing_native_location_v1 (%)', v_live;
end $verify$;
