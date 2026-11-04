-- Enroll today's four guarded row repairs (backlog 1261/1263) so the registry's permanent rotation re-verifies them.
insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by, last_detail) values
 ('20261103170854', 'wasalt_archive_never_restores_an_impossible_price',
  'No active wasalt sale row holds a price whose own per-metre figure is > 2,000,000 SAR/m² because a stale archive restored it: wasalt_preserve_detail() refuses an archive whose own rate is impossible; the five measured rows carry wasalt''s live price.',
  'mon_detect_field_integrity', 'outside engineer 2026-11-03 (author of the repair)', jsonb_build_object('rows_changed', 5, 'checked', 'production, at enrollment')),
 ('20261103170936', 'wasalt_rate_guard_ignores_an_impossible_rate',
  'No active wasalt sale row has its real total parked in price_per_meter as an impossible (> 2,000,000 SAR/m²) "rate" with price_total NULL.',
  'mon_detect_rate_served_as_total', 'outside engineer 2026-11-03 (author of the repair)', jsonb_build_object('rows_changed', 5, 'parked_after', 0)),
 ('20261103171050', 'wasalt_seven_prices_restored_from_an_impossible_rate',
  'Same invariant as 20261103170936 for the seven further rows read live from wasalt the same day.',
  'mon_detect_rate_served_as_total', 'outside engineer 2026-11-03 (author of the repair)', jsonb_build_object('rows_changed', 7, 'parked_after', 0)),
 ('20261103171256', 'haraj_redundant_thousands_area_repair',
  'No active haraj row stores an area ×1000 of the seller''s «N الاف» (N >= 1000) figure; the parser no longer scales the redundant plural.',
  'mon_detect_field_integrity', 'outside engineer 2026-11-03 (author of the repair)', jsonb_build_object('rows_changed', 3))
on conflict (repair_version) do nothing;