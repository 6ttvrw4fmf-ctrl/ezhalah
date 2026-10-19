-- Enroll the 2026-10-07 sakan prepared-elevator repair (20261007075738) so it is re-verified forever.
insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by,
   last_verified_at, last_verdict, last_detail)
values
  ('20261007075738',
   'sakan_prepared_elevator_is_not_an_elevator',
   'No active sakan_residential_listings row is stored elevator = yes when its only elevator mentions are a '
   || 'prepared-shaft prefix («تأسيس مصعد», «مؤسس مصعد», «مهيأ مصعد») and sakan''s structured feature chips carry '
   || 'no elevator. Prepared is neither yes nor no: NULL.',
   'mon_detect_sakan_prepared_elevator_as_yes',
   'new_listings_engineer',
   now(), 'holds',
   jsonb_build_object('rows_repaired', 278, 'first_seen_today', 1, 'example', 'sakan_residential_listings:15854735',
                      'cause_fix', 'scrapers/common/normalize.py amenities_from_text prefix window',
                      'detector_on_roster', true))
on conflict do nothing;
