-- Enroll the 2026-11-03 aqar non-Villa maid/driver NULL repair (20261103233906, owner decision 5) in the
-- orphaned-guarantee registry (repair-enrollment-guard red on 20261103233906, alert 12925). Invariant
-- re-verified against production immediately before this insert: 0 non-Villa rows carry maid_room or
-- driver_room in aqar_residential_listings and aqar_commercial_listings. Data-only insert: no DDL, so
-- PostgREST does not reload its schema cache.
insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by)
values ('20261103233906',
        'aqar_non_villa_maid_driver_room_null',
        'No aqar row whose property_type is not Villa carries a maid_room or driver_room value: aqar publishes those two fields only on its Villa ad form, so a non-Villa value is not a source value (owner decision 5, 2026-11-03).',
        'mon_detect_fabricated_unpublished_amenity',
        'live-checks-and-seams engineer 2026-11-04 (enrolling another session''s repair)')
on conflict do nothing;
