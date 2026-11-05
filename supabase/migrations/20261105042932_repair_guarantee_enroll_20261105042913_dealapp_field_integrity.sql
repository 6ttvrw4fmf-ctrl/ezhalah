-- Enroll 20261105042913 in the orphaned-guarantee registry. Data-only insert, no DDL.
insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by)
values ('20261105042913', 'dealapp_two_field_integrity_rows_adjudicated_from_their_pages',
        'No active dealapp row serves a phone/ID-shaped or physically impossible price unless its own page publishes it (recorded in ops_price_source_verified); the ad proven gone stays hidden (adjudicated).',
        'mon_detect_field_integrity', 'outside engineer 2026-11-05 (author of the repair)')
on conflict do nothing;