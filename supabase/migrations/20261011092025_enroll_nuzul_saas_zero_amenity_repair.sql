-- Enroll the 2026-10-11 Nuzul SaaS zero-amenity repair (20261011091948) so it is re-verified forever.
insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by,
   last_verified_at, last_verdict, last_detail)
values
  ('20261011091948',
   'nuzul_saas_zero_amenity_no_is_silence',
   'No active aldarim, abwbna, alobid or bahadhabab row stores elevator, parking, air_conditioner, electricity, '
   || 'water_supply or sanitation = no while its own source_capture holds 0 or nothing for that field. These sites '
   || 'never print a «no»: silence is NULL.',
   'mon_detect_aldarim_saas_unfilled_block_false',
   'advanced_filter_engineer',
   now(), 'holds',
   jsonb_build_object('rows_repaired', 18, 'active_rows_repaired', 13, 'example', 'abwbna_residential_listings:10777660',
                      'cause_fix', 'scrapers/{aldarim,abwbna,alobid,bahadhabab}/run.py _yes_or_silence (2026-10-09)',
                      'detector_on_roster', true))
on conflict do nothing;
