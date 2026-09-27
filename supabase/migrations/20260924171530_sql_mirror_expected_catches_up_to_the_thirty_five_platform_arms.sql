-- ops_sql_mirror_expected catches up to listing_native_location_v1's new shape.
--
-- 20260924170648 added seventy arms to that matview (dwelleo, aqalemhajer, sakani, shatri, alqasem,
-- fkralemar, wadod, almuteb, aalbarrak, alrifai, sodasyat, hasaad, aqaralriyadh, justsa, snam,
-- jawher, m3tmd, senan, goldendeal, thousand, yameen, ebriza, eilmalriyada, daryusuf, albdah, eydah,
-- tamyaz, hazim, villassa, marksa, rightcompound, livingcompound, azure, expattrusted, flow —
-- residential + commercial each), right after the nufouth commercial arm, so its definition
-- genuinely changed: 51,672 chars / md5 024fa413d718ee03c6aa13af77894de7 becomes 93,797 chars /
-- md5 70d106fc0bd506b9bc69497f4ad0745b.
--
-- HOW THE NEW DIGEST WAS DERIVED without touching production: the rendered arm text was PROVEN on
-- the previous onboarding first — splicing the same arm rendering into the pre-#3516 body
-- (dcda0a5ff4fe7942c22bb8d37af5dca0) reproduces #3516's live digest 024fa413d718ee03c6aa13af77894de7
-- byte for byte — and then applied to today's live body (md5-verified equal to
-- sql/mirrors/listing_native_location_v1.sql, read 2026-09-24 15:02 UTC). If v1 drifts before this
-- lands, the verify below fails, which is the point: the mirror and this row must then be
-- regenerated from pg_get_viewdef, never re-dated.
--
-- Regenerating a mirror is a TWO-PLACE edit and verify-mirror-md5-is-registered enforces both
-- halves: sql/mirrors/listing_native_location_v1.sql carries the new body, and this migration
-- registers the same digest so the live drift detector compares against what production has.
update public.ops_sql_mirror_expected
   set expected_md5 = '70d106fc0bd506b9bc69497f4ad0745b',
       recorded_at = now(),
       note = 'Regenerated 2026-09-24 after 20260924170648 added the thirty-five-platform arms '
              || '(dwelleo … flow, 70 in total) right after the nufouth commercial arm. '
              || '51,672 -> 93,797 chars.'
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
