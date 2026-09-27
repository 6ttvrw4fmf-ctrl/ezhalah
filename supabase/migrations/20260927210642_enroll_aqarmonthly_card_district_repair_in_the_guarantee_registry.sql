-- Repair 20260927201934 landed without a registry row, and the enrollment limb caught it within
-- the hour: scripts/verify-repair-guarantee-enrollment-live.ts went red on main immediately after
-- the merge (run 36350324930, "1 repair(s) the registry rotation can NEVER reach: 20260927201934").
--
-- The registry is the STANDING half of the orphaned-guarantee contract. The waiver added in
-- scripts/verify-repair-migrations-are-guarded.ts satisfies the FILE-level rule (the repair file
-- itself cannot name a detector that did not exist when it ran); it does not enroll the repair in
-- the oldest-first rotation that re-verifies the invariant against production. Both halves are
-- required, and the author of the repair owns both.
--
-- INVARIANT RE-VERIFIED AGAINST PRODUCTION AT ENROLLMENT (not re-read from the repair's comments),
-- 2026-09-27 21:1x UTC:
--   aqarmonthly_residential_listings : 1,801 active rows, 0 where neighborhood IS DISTINCT FROM
--                                      district_ar. 1,656 carry a card district (pre-repair: 1,402).
--   detector                          : mon_detect_aqarmonthly_card_district_drift() exists, is on
--                                      the mon_run_all_detectors() roster, is not blind (last ok
--                                      aqarmonthly run 2026-09-27 06:24Z), and would raise 0 rows.
--                                      No alert is open on its dedup key, so a drift-back raises
--                                      rather than being swallowed by mon_raise()'s open-key return.
-- Hence last_verdict = 'holds'.
--
-- MEASURED AND RECORDED RATHER THAN GLOSSED: 33 active rows currently have a card district that
-- differs from the one search_listings_ar serves. That is NOT this invariant drifting — the raw
-- pair is equal on all 1,801 rows. It is the served index lagging a CONCURRENT repair by another
-- session (20260927205755 aqarmonthly_street_is_not_a_district, applied 20:57Z), which corrected
-- the raw district for the «حي شارع …» street-as-district class; the card and the raw column
-- already show the corrected district («حي الدويخلة»), while the index still carries the stale
-- street value until its next sync. Stated here so the next reader inherits the measurement
-- instead of re-deriving it, and so a rotation pass that samples during a sync window is not
-- mistaken for this repair decaying.
insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by,
   last_verified_at, last_verdict, last_detail)
values
  ('20260927201934',
   'aqarmonthly_card_district_realigned_to_the_parsed_district',
   'Every active aqarmonthly_residential_listings row renders the SAME district to a user that it '
   || 'was matched on: neighborhood (which ResultCard prints verbatim whenever it is Arabic, per the '
   || 'owner display rule of 2026-07-06, via remote.ts LIST_SELECT → district: r.neighborhood) is '
   || 'never DISTINCT FROM district_ar (which listing_native_location_v1 and search_listings_ar are '
   || 'built from). One parse, two columns. A row with no catalog-confirmed district carries NULL in '
   || 'both — an honest unknown, never a slug fragment.',
   'mon_detect_aqarmonthly_card_district_drift',
   'ad-hoc session 2026-09-27 (author of the repair)',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'active_rows', 1801,
     'rows_violating_invariant', 0,
     'rows_with_card_district', 1656,
     'rows_with_card_district_before_repair', 1402,
     'detector_exists', true,
     'detector_on_roster', true,
     'detector_blind', false,
     'detector_last_ok_platform_run', '2026-09-27T06:24:16Z',
     'detector_would_raise_rows', 0,
     'open_alerts_on_dedup_key', 0,
     'row_level_drift_coverage', true,
     'card_vs_served_index_mismatch_rows', 33,
     'card_vs_served_index_note', 'NOT this invariant. The raw pair is equal on all 1,801 rows. These '
       || '33 are search_listings_ar lagging a concurrent repair by another session '
       || '(20260927205755 aqarmonthly_street_is_not_a_district, applied 20:57Z) that corrected the '
       || 'raw district for the «حي شارع …» street-as-district class; card and raw already show the '
       || 'corrected district, the index clears on its next sync.',
     'found_by', 'scripts/verify-repair-guarantee-enrollment-live.ts, red on main run 36350324930 '
       || 'minutes after PR #4995 merged',
     'why_it_would_be_wrong_to_drift', 'A drift-back means a user reads one district on the card '
       || '(«الفرسان الدمام الدمام») while search matched the listing on another («حي الفرسان») — the '
       || 'live 2026-09-21 bug, found by real-user testing rather than by any monitor, because every '
       || 'district monitor watched the column the card does not render.'));

do $$
declare v_verdict text; v_detector text;
begin
  select last_verdict, detector into v_verdict, v_detector
    from public.ops_repair_guarantee_registry where repair_version = '20260927201934';
  if v_verdict is distinct from 'holds' or v_detector is null then
    raise exception 'enrollment row missing or not verified for 20260927201934';
  end if;
  if to_regprocedure('public.' || v_detector || '()') is null then
    raise exception 'registry names a detector that does not exist: %', v_detector;
  end if;
end $$;
