-- Enroll repair 20261025083536 (muhaysini «مفروشة: لا» served as furnished = yes) in the repair-guarantee registry, so its
-- invariant is re-verified on rotation like every other listing repair.
insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by, last_verified_at, last_verdict, last_detail)
values
  ('20261025083536',
   'muhaysini_labelled_no_is_not_furnished',
   'No active muhaysini ad stores furnished = true while its own description answers a furnished label with a '
   || 'negator («مفروشة: لا», «**مفروش:** لا», «مؤثثة: لا يوجد», «بدون»), unless the platform''s structured '
   || 'furnished field itself says true. The shared prose reader read the labelled «لا» as yes; '
   || 'normalize._amenities_in_clause reads a label''s value since PR 8611.',
   'mon_detect_muhaysini_labelled_no_read_as_furnished',
   'muhaysini labelled-no repair 2026-10-25 (author of the repair)',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'rows_changed', 1997,
     'active_furnished_yes_to_no', 1496,
     'active_furnished_yes_to_unknown', 32,
     'active_furnished_unknown_to_no', 326,
     'active_parking_kitchen_ac_yes_to_unknown', 6,
     'detector_rows_before', 1060,
     'detector_rows_after', 0,
     'detector_on_roster', true,
     'detector_raise_path_executed', true,
     'forward_fix', 'scrapers/common/normalize.py _LABEL_RE / _LABEL_NO_RE, pinned by '
                 || 'scripts/verify-labelled-no-is-not-a-yes.ts (3 mutants caught; fails 7 of 9 phrases on the old reader)'))
on conflict do nothing;
