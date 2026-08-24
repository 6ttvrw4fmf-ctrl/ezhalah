-- Owner directive (2026-08-24, PR #1023 approval): mon_detect_prune_kill_without_source_verdict()
-- must be ROSTER-wired, not only reachable via its own cron job.
--
-- The original migration (20260824075709) gave it a standalone daily cron at 08:42 to avoid
-- lengthening the twice-hourly sweep. That caution is now measured rather than assumed: the detector
-- runs in **12 ms** (two counts over three registered tables), against a sweep that uses ~170 s of a
-- 900 s budget. The cost is nil, and roster membership is strictly better — it runs twice an hour
-- instead of once a day, and it is covered by mon_detect_detector_sweep_budget /
-- mon_detect_stalled_daily_detector like every other roster entry.
--
-- The standalone cron job is REMOVED in the same migration, so the detector runs exactly once per
-- sweep rather than being double-scheduled.
--
-- WHY A TARGETED INSERTION AND NOT A FULL CREATE OR REPLACE. mon_run_all_detectors() carries a
-- ~40-entry hardcoded array that concurrent sessions edit routinely (AGENTS.md: this project and DB
-- are worked by parallel sessions). Re-emitting the whole body from a snapshot taken minutes earlier
-- would silently clobber any detector another session added in between. This inserts one element
-- into the live definition and is idempotent — re-running it is a no-op.

do $$
declare
  d text;
  anchor constant text := '''mon_detect_enumeration_incomplete'',';
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if d is null then
    raise exception 'mon_run_all_detectors() not found — roster wiring cannot proceed';
  end if;

  if position('mon_detect_prune_kill_without_source_verdict' in d) > 0 then
    raise notice 'already roster-wired; nothing to do';
    return;
  end if;

  if position(anchor in d) = 0 then
    raise exception 'roster anchor % not found in mon_run_all_detectors() — refusing to guess an '
                    'insertion point (a silent no-op here would leave the barrier unreachable)', anchor;
  end if;

  d := replace(d, anchor,
               anchor || E'\n    ''mon_detect_prune_kill_without_source_verdict'',');
  execute d;
end $$;

-- Assert the wiring actually landed: a barrier nothing calls is decoration (§11a), and a migration
-- that silently failed to wire one is worse than no migration at all.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mon_run_all_detectors'
       and pg_get_functiondef(p.oid) like '%mon_detect_prune_kill_without_source_verdict%')
  then
    raise exception 'roster wiring did not take effect';
  end if;
end $$;

-- Now that the roster calls it twice an hour, the standalone daily job is redundant.
select cron.unschedule('mon-prune-kill-without-source-verdict')
 where exists (select 1 from cron.job where jobname = 'mon-prune-kill-without-source-verdict');
