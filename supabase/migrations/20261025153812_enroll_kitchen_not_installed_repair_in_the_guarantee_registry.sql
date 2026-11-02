-- Enroll repair 20261025153723 («مطبخ غير راكب» — a kitchen that is not installed — served as kitchen = yes) in the
-- repair-guarantee registry, so its invariant is re-verified on rotation.
insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by, last_verified_at, last_verdict, last_detail)
values
  ('20261025153723',
   'kitchen_not_installed_is_unknown',
   'No active ad on a site whose kitchen answer comes from the ad''s own words stores kitchen = true while those words '
   || 'say «مطبخ غير راكب» / «المطبخ: غير مركب» / «مطبخ (غير راكب)» right after it (rows whose structured chips or counts '
   || 'name a kitchen excepted). Not installed is "prepared only" = unknown (coordinator for the owner''s four outcomes, '
   || '2026-10-25); normalize._NOT_INSTALLED_RE + _veto_not_installed since PR 8686.',
   'mon_detect_not_installed_served_as_yes',
   'kitchen not-installed repair 2026-10-25 (author of the repair)',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'rows_changed', 180,
     'ads', 158, 'ads_active', 130,
     'kitchen_yes_to_unknown', 149, 'kitchen_yes_to_unknown_active', 122,
     'ac_elevator_yes_to_unknown', 30, 'ac_elevator_yes_to_unknown_active', 28,
     'furnished_yes_to_no', 1,
     'detector_rows_before', 101,
     'detector_rows_after', 0,
     'detector_on_roster', true,
     'detector_raise_path_executed', true,
     'forward_fix', 'PR 8686: scrapers/common/normalize.py (_NOT_INSTALLED_RE word-bounded with describing words and '
                 || 'co-subjects, _veto_not_installed, broken-word negator fillers); ADVANCED_FILTER_SOURCE_TRUTH.md §2; '
                 || 'pinned by scripts/verify-labelled-no-is-not-a-yes.ts (15 mutants caught)'))
on conflict do nothing;
