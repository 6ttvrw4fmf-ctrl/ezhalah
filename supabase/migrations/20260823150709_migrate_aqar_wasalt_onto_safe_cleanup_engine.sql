-- Applied 2026-08-23 by Data Integrity run #39 (owner-directed hardening pass), from the merged
-- PR #898. SQL body identical to supabase/migrations/20260822140529_migrate_aqar_wasalt_onto_safe_
-- cleanup_engine.sql; see that file for the full audit rationale (measured exposure, the 28%
-- still-live rate gathern's pilot found, and the required dry-run rollout sequence).

update public.platform_retention_policy
   set enabled = true,
       note = 'Migrated onto the unified engine 2026-08-22 (owner-directed safety audit, PR #898). '
              || 'Legacy aqar-cleanup.yml/wasalt-cleanup.yml now call scrapers.common.cleanup '
              || 'instead of the old no-recheck scrapers/aqar/cleanup.py — same filenames, same '
              || 'pg_cron schedule, same 30-day/3-strike thresholds, PLUS the final live re-check + '
              || 'anomaly/fraction guards + per-row audit trail this platform never had before. '
              || 'REQUIRED: the first run after this ships must be a manual dry_run=true dispatch, '
              || 'reviewed by a human, before the next scheduled real run.'
 where platform in ('aqar', 'wasalt');

-- Fail loud, not quiet, if the expected rows are somehow missing (the seed migration inserts them
-- with ON CONFLICT DO NOTHING, so both should always exist by the time this runs).
do $$
declare n int;
begin
  select count(*) into n from public.platform_retention_policy where platform in ('aqar','wasalt') and enabled;
  if n <> 2 then
    raise exception 'expected exactly 2 platform_retention_policy rows (aqar, wasalt) enabled=true after this migration, got %', n;
  end if;
end $$;
