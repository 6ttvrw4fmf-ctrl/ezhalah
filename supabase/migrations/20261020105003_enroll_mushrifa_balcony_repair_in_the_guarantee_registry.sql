-- 🔬 AF engineer 2026-10-20: enroll repair 20261020104914 (district name «مشرفة» read as a balcony) in the
-- orphaned-guarantee registry, so its invariant is re-verified on rotation like every other listing repair.
insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by, last_verified_at, last_verdict, last_detail)
values
  ('20261020104914',
   'district_name_mushrifa_is_not_a_balcony',
   'No active muhaysini or dwelleo ad in Jeddah''s district «مشرفة» stores balcony_terrace = true unless its own text '
   || 'names a balcony («بلكونة», «تراس», «شرفات», a «شرفة» not inside «مشرفة», or English balcony / terrace). The '
   || 'shared prose reader read «شرفة» out of the district name «مشرفة»; normalize._EMBEDDED_IN_NAME refuses that '
   || 'collision since PR 7863.',
   'mon_detect_district_name_read_as_balcony',
   'advanced_filter engineer 2026-10-20 (author of the repair)',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'rows_repaired_muhaysini', 101,
     'rows_repaired_dwelleo', 26,
     'served_mushrifa_balcony_before', 148,
     'served_mushrifa_balcony_after', 21,
     'customer_path', 'anon location_search_candidates_ar جدة / حي مشرفة / شقة / بيع / balcony: 85 rows before, 12 after, af_eligible_count 12',
     'detector_on_roster', true,
     'detector_raise_path_executed', true,
     'forward_fix', 'scrapers/common/normalize.py _EMBEDDED_IN_NAME, pinned by test_fursaghyr_feature_checklist.py '
                 || 'test_a_district_name_is_not_a_balcony, which fails when the guard is removed'))
on conflict do nothing;