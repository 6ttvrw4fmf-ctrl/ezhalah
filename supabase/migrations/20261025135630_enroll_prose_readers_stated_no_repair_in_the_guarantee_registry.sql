-- Enroll repair 20261025135301 (the 21 yes-or-nothing prose readers now store an explicit «لا» as no; a negation is
-- tied to its own word) in the repair-guarantee registry, so its invariant is re-verified on rotation.
insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by, last_verified_at, last_verdict, last_detail)
values
  ('20261025135301',
   'prose_readers_store_a_stated_no',
   'No active ad on a prose-only site (abralosol, akariyoun, alhoshan, alkhaas, awal, haraj, jurash, ksaaqar, '
   || 'opensooq, raghdan, rakez, rawasidark, remal, sadiqeltajer, shomou, sirdab, therc, vmksa) stores elevator = true '
   || 'while its own title or description says «بدون مصعد» / «لا يوجد مصعد» / «غير متوفر مصعد» next to it. Prose may '
   || 'answer yes, no (only on a negation tied to the word) or unknown, and only for fields the platform does not '
   || 'publish structurally (owner, 2026-10-24; the 2026-09-20 four outcomes). normalize.prose_amenities since PR 8674.',
   'mon_detect_prose_no_served_as_yes',
   'prose readers stated-no repair 2026-10-25 (author of the repair)',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'rows_changed', 220,
     'rows_active', 180,
     'unknown_to_no', 178, 'unknown_to_no_active', 143,
     'not_installed_yes_to_unknown', 25, 'not_installed_yes_to_unknown_active', 24,
     'untied_no_to_unknown', 8, 'untied_no_to_unknown_active', 7,
     'untied_no_to_yes', 9, 'untied_no_to_yes_active', 6,
     'detector_rows_before', 0,
     'detector_rows_after', 0,
     'detector_stating_no_active', 48,
     'detector_on_roster', true,
     'detector_raise_path_executed', true,
     'forward_fix', 'PR 8674: scrapers/common/normalize.py (prose_amenities, _negated_before / _TIED_TAIL_RE, '
                 || '_NOT_INSTALLED_AFTER) and the 21 prose call sites; ADVANCED_FILTER_SOURCE_TRUTH.md §2; pinned by '
                 || 'scripts/verify-labelled-no-is-not-a-yes.ts (10 mutants caught)'))
on conflict do nothing;
