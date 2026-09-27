-- Regenerating a mirror is a TWO-PLACE edit (verify-mirror-md5-is-registered): the file in
-- sql/mirrors and this registered digest must move together. 20260925012657 added أبعاد (abaad)'s
-- residential + commercial arms to listing_native_location_v1, so the mirror was regenerated and
-- this row catches up.
--
-- The new body was NOT re-downloaded: the two arms were spliced into the previous mirror body in
-- the identical rendering pg_get_viewdef produces for every other arm, and the result was then
-- PROVEN equal to production — md5 of the spliced text (trailing newline stripped, which is how
-- pg_get_viewdef returns it) matched the live digest exactly, over the same 94,952 chars. 93,797 →
-- 94,952 chars.
update public.ops_sql_mirror_expected
   set expected_md5 = '6a0c034c408d43d3f179bafef7f97a55',
       recorded_at = now(),
       note = 'Regenerated 2026-09-25 after 20260925012657 added the abaad residential + commercial '
              || 'arms right after the nufouth commercial arm. 93,797 -> 94,952 chars.'
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
  -- and the arms this change is about must actually be in there
  if position('abaad_residential_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) = 0 then
    raise exception 'the abaad arm is not in the live view — refusing to register a digest for it';
  end if;
  raise notice 'ops_sql_mirror_expected now matches the live listing_native_location_v1 (%)', v_live;
end $verify$;
