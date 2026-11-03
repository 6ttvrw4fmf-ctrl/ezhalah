-- Enroll the 2026-11-03 rent-period / unlocated repair in the orphaned-guarantee registry (repair-enrollment-guard
-- red on 20261103204042). Data-only insert: no DDL, so PostgREST does not reload its schema cache.
-- The detector named is the one that repair's own SQL rewrote to judge served rent periods and is in the roster.
insert into public.ops_repair_guarantee_registry (repair_version, repair_name, invariant, detector, registered_by)
values ('20261103204042',
        'rent_period_judged_flag_follows_source_and_unlocated_rows_carry_no_city_ids',
        'A served rent period is either the source''s stated period or the owner''s silent-period judgment (rent_period_judgment_holds); the judged flag follows the source on every sync; a row with no proven city carries no city match ids.',
        'mon_detect_rent_period_contract',
        'outside engineer 2026-11-03 (backlog 1263, enrolling another session''s repair)')
on conflict do nothing;