-- Enroll the 2026-11-03 haraj price-equals-area repair in the orphaned-guarantee registry (repair-enrollment-guard
-- red on 20261103194345). Data-only insert: no DDL, so PostgREST does not reload its schema cache.
insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by)
values ('20261103194345',
        'price_eq_area_adjudicated_haraj_sanadak',
        'No active row serves a price equal to its own stated area (or price per metre) unless the source publishes that number and it is recorded as source-verified; haraj no longer reads a bare «للبيع NالF» size as the price.',
        'mon_detect_price_eq_area_or_ppm',
        'outside engineer 2026-11-03 (backlog 1263, enrolling another session''s repair)')
on conflict do nothing;