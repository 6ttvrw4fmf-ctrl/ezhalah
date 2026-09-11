-- ROUTINE #7 SYSTEMS SEAM ENGINEER (2026-09-11) — the migration<->mirror seam, one hop further.
--
-- alert_event 1740 (sql_mirror_drift, P1, raised 2026-09-06 17:59Z) has stayed OPEN since PR #2265
-- (landed today) regenerated sql/mirrors/listing_native_location_v1.sql verbatim from live
-- pg_get_viewdef — its own header already records the correct new digest
-- 862a10b719341ab0d425b81b02d69871 (18887 chars, +8 UNION ALL arms for abwbna/bahadhabab/alobid
-- native-location wiring + azdad activation). But 20260811130514_sql_mirror_live_drift_detector.sql
-- says explicitly: "A legitimate change to one of these objects must update the mirror file AND
-- this table in the same migration" — PR #2265 did the first half and not the second, so
-- ops_sql_mirror_expected.expected_md5 for this row is still the STALE 2026-08-11-seeded value
-- 31036a9c8b92fddc5293b700985b869d. mon_detect_sql_mirror_drift() compares live to THIS TABLE, not
-- to the mirror file's own header comment, so it has been correctly reporting drift against a
-- digest that itself went stale — the mirror file is fine, the tracking row was the seam that broke.
--
-- Verified before writing this: md5(pg_get_viewdef('public.listing_native_location_v1'::regclass,
-- true)) live right now = 862a10b719341ab0d425b81b02d69871, exactly matching both the mirror
-- file's header and the alert's own recorded live_md5. No further drift since the alert was raised.
update public.ops_sql_mirror_expected
   set expected_md5 = '862a10b719341ab0d425b81b02d69871',
       recorded_at = now(),
       note = note || ' | 2026-09-11 routine-7-seam: caught up to PR #2265''s regeneration ' ||
              '(31036a9c... -> 862a10b7..., 14127 -> 18887 chars, 8 new UNION ALL arms for ' ||
              'abwbna/bahadhabab/alobid + azdad); the mirror file was already correct, only this ' ||
              'tracking row had gone stale.'
 where object_name = 'listing_native_location_v1'
   and expected_md5 = '31036a9c8b92fddc5293b700985b869d';

-- Self-heal proof: running the detector now must resolve the still-open alert, not just print clean.
do $mut$
declare v_n int;
begin
  if not exists (select 1 from public.ops_sql_mirror_expected
                  where object_name='listing_native_location_v1'
                    and expected_md5='862a10b719341ab0d425b81b02d69871') then
    raise exception 'update did not land — expected_md5 still wrong';
  end if;
  v_n := public.mon_detect_sql_mirror_drift();
  if exists (select 1 from public.alert_event where dedup_key='sql_mirror_drift' and resolved_at is null) then
    raise exception 'sql_mirror_drift alert still open after catching up the expected digest';
  end if;
  raise notice 'sql_mirror_drift: expected digest caught up, detector re-ran, alert 1740 self-cleared';
end $mut$;
