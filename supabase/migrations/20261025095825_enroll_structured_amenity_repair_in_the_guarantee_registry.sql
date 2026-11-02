insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by, last_verified_at, last_verdict, last_detail)
values
  ('20261025095744',
   'structured_amenity_reaches_its_column_aouj_aqaralsaudia_alta',
   'No active aouj, aqaralsaudia or alta ad stores NULL for an amenity its own structured field states: '
   || 'a garage count above 0 is parking on aouj and aqaralsaudia, and a ticked «مصعد», «غرفة خادمة» or '
   || '«مدخل سيارة» in alta''s feature list is elevator, maid_room or car_entrance.',
   'mon_detect_structured_amenity_not_stored',
   'AF engineer structured amenity repair 2026-10-25 (author of the repair)',
   now(), 'holds',
   jsonb_build_object(
     'checked', 'production, at enrollment',
     'rows_changed', 25,
     'aouj_parking_unknown_to_yes', 4,
     'aqaralsaudia_parking_unknown_to_yes', 11,
     'alta_elevator_maid_car_entrance_unknown_to_yes', 10,
     'detector_raised_before_repair', true,
     'detector_open_after_repair', 0,
     'detector_on_roster', true,
     'forward_fix', 'PR 8649 scrapers/aouj/run.py amenities(), PR 8650 scrapers/aqaralsaudia/run.py garage, '
                 || 'PR 8651 scrapers/alta/run.py property_features, each pinned by a test that fails on the old parser'))
on conflict do nothing;
