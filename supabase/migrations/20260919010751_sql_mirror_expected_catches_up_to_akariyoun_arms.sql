-- The listing_native_location_v1 mirror tracking row catches up to the عقاريون wiring.
--
-- Regenerating a mirror is a TWO-PLACE edit and verify-mirror-md5-is-registered enforces it:
-- sql/mirrors/<obj>.sql AND this row must carry the same digest. I updated the file and not the
-- row, and CI caught it — which is the point: a mirror whose registered digest disagrees with the
-- file is a mirror nobody can trust, and the failure mode is silent belief rather than a visible
-- error.
--
-- 20260918234916_akariyoun_wiring_into_search added two arms for عقاريون at the same aldarim
-- anchor suwar's and rakez's used, so production now reads
-- aldarim -> akariyoun -> rakez -> suwar -> amlakalahsa -> aqaralsaudia.
-- 26,097 -> 27,332 chars. The file was rebuilt by splicing at that anchor and byte-verified against
-- pg_get_viewdef('public.listing_native_location_v1'::regclass, true).
update public.ops_sql_mirror_expected
   set expected_md5 = '522c0705053f9b2f1806b83520061858',
       recorded_at  = now(),
       note = note || ' | 2026-09-18: caught up to the akariyoun wiring (20260918234916) — 2 new arms, 26097 -> 27332 chars.'
 where mirror_path = 'sql/mirrors/listing_native_location_v1.sql';

do $verify$
declare v_md5 text; v_live text;
begin
  select expected_md5 into strict v_md5 from public.ops_sql_mirror_expected
   where mirror_path = 'sql/mirrors/listing_native_location_v1.sql';
  select md5(pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) into v_live;
  if v_md5 <> v_live then
    raise exception 'registered digest % does not equal the LIVE view digest % — the row would be a lie', v_md5, v_live;
  end if;
end $verify$;