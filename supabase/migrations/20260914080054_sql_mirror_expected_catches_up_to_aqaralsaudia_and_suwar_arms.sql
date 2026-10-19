-- sql/mirrors/listing_native_location_v1.sql was regenerated; this is the second half of that
-- two-place edit (verify-mirror-md5-is-registered.ts owns the pairing).
--
-- The mirror had gone stale for TWO wirings, not one: 20260913221143 (aqaralsaudia) refreshed
-- neither the file nor this row, and 20260914070904 (suwar) landed on top of that. Four UNION ALL
-- arms are new. They are deliberately NOT contiguous — each wiring migration anchored on a
-- different existing arm — so production reads aldarim → suwar → amlakalahsa → aqaralsaudia, and
-- the regenerated file reproduces that order rather than appending both pairs in one place.
--
-- 52b8d750cd49b1f46fdb471499678afc (22,492 chars) → 7ed90d5f6343aff0d88aa702260a379b (24,942).
-- The new digest is md5(pg_get_viewdef('public.listing_native_location_v1'::regclass, true)) read
-- off production, and the committed file's body hashes to exactly that — byte-verified, not
-- approximated.
update public.ops_sql_mirror_expected
   set expected_md5 = '7ed90d5f6343aff0d88aa702260a379b',
       recorded_at  = now(),
       note = note || ' | 2026-09-14: caught up to the aqaralsaudia (20260913221143) AND suwar '
                   || '(20260914070904) search wirings — 4 new UNION ALL arms, 22492 -> 24942 chars. '
                   || 'The aqaralsaudia refresh was missed on 09-13; both are reconciled here.'
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