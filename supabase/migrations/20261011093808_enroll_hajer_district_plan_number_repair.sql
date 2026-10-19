-- Enroll the 2026-10-11 hajer district plan-number repair (20261011093718) so it is re-verified forever.
insert into public.ops_repair_guarantee_registry
  (repair_version, repair_name, invariant, detector, registered_by,
   last_verified_at, last_verdict, last_detail)
values
  ('20261011093718',
   'hajer_district_drops_plan_number',
   'No production-ready search_listings_ar row carries a subdivision plan number such as (1100/4) in district_ar. '
   || 'The district matches on our name; the card keeps the source''s number through neighborhood (owner rule 2026-09-14).',
   'mon_detect_district_plan_number_stranded',
   'advanced_filter_engineer',
   now(), 'holds',
   jsonb_build_object('rows_repaired', 25, 'example', 'hajer_residential_listings:584515',
                      'cause_fix', 'scrapers/hajer/run.py _district_without_plan_number',
                      'detector_on_roster', true))
on conflict do nothing;
