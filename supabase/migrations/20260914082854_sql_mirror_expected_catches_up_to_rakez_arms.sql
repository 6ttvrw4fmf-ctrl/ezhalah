-- sql/mirrors/listing_native_location_v1.sql regenerated again; second half of the two-place edit
-- (verify-mirror-md5-is-registered.ts owns the pairing).
--
-- 20260914081716 (rakez wiring) added two more UNION ALL arms on the aldarim anchor, so production
-- now reads aldarim → rakez → suwar → amlakalahsa → aqaralsaudia.
-- 7ed90d5f6343aff0d88aa702260a379b (24,942 chars) → 5fb92dbf2a54966df41d0401918a9af5 (26,097).
-- The committed file's body hashes to exactly pg_get_viewdef's output — byte-verified.
update public.ops_sql_mirror_expected
   set expected_md5 = '5fb92dbf2a54966df41d0401918a9af5',
       recorded_at  = now(),
       note = note || ' | 2026-09-14: caught up to the rakez wiring (20260914081716) — 2 new arms, '
                   || '24942 -> 26097 chars.'
 where object_name = 'listing_native_location_v1';

do $verify$
declare v_expected text; v_live text;
begin
  select expected_md5 into strict v_expected
    from public.ops_sql_mirror_expected where object_name = 'listing_native_location_v1';
  select md5(pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) into v_live;
  if v_expected is distinct from v_live then
    raise exception 'expected_md5 % does not match live %', v_expected, v_live;
  end if;
end $verify$;