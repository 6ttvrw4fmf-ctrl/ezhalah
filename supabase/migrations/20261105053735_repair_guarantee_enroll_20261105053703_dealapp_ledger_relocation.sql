-- Enroll 20261105053703 in the orphaned-guarantee registry. Data-only insert, no DDL.
insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by)
values ('20261105053703', 'dealapp_620694_deactivation_leaves_the_deletion_ledger',
        'No cleanup_deletion_log row claims a deletion for a listing that still exists; a deactivation lives in ops_stale_inactivation_probe.',
        'mon_detect_deletion_log_without_delete', 'outside engineer 2026-11-05 (author of the repair)')
on conflict do nothing;