-- Enroll the 2026-11-04 almuteb retirement (20261104094609) in the orphaned-guarantee registry.
-- Data-only insert: no DDL, so PostgREST does not reload its schema cache.
insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by)
values ('20261104094609',
        'retire_almuteb_domain_does_not_resolve',
        'The 11 retired almuteb listings (almuteb.sa NXDOMAIN, owner decision 2026-11-04) stay inactive and adjudicated; an adjudicated row that comes back active is raised.',
        'mon_detect_adjudicated_reactivation',
        'sakani-403-and-almuteb engineer 2026-11-04 (author of the repair)')
on conflict do nothing;
