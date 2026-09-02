-- A CRON COMMAND MUST BE DERIVED FROM THE LIVE ONE, NEVER PASTED (routine #7, 2026-08-31).
--
-- 20260831192229 chained P0 detection onto the fast lane by handing cron.alter_job a hand-written
-- literal command. scripts/verify-monitoring-sweep-is-guarded.ts caught it, and it is right on the
-- substance even though its matcher keyed on this migration MENTIONING the sweep job in prose while
-- actually editing jobid 86: a pasted command silently drops whatever the author's copy predates.
-- This repo has been bitten by that class repeatedly -- it is the same failure as a full-body
-- CREATE OR REPLACE on a live function from a stale copy. Concurrent sessions edit cron here.
--
-- If another session had added a statement to jobid 86 between that migration's read and its write,
-- the paste would have erased it with nothing to notice. The window was small and nothing was in
-- fact lost -- verified below, the live command still contains exactly the two intended statements
-- -- but "we got away with it" is not the standard the guard encodes.
--
-- So the wiring is re-established the correct way: read the LIVE command and replace() a needle
-- inside it, preserving every statement present at write time whether or not this author knew
-- about it. Idempotent -- with the lane already correct this is a verified no-op, and it stays
-- correct if a future session adds a statement to the lane before it runs again.
--
-- THE SCHEDULE IS STILL NOT TOUCHED. cron.alter_job is passed only `command`; jobid 86 keeps its
-- 24 owner-approved minute slots and its 45s statement_timeout. Asserted after the write.

do $derive$
declare
  v_sched_before text;
  v_cmd          text;
  v_new          text;
  c_needle constant text := 'select public.mon_dispatch_p0_fast();';
  c_insert constant text := 'select public.mon_run_p0_detectors();' || chr(10)
                            || '    select public.mon_dispatch_p0_fast();';
begin
  select schedule, command into v_sched_before, v_cmd from cron.job where jobid = 86;
  if v_sched_before is null then
    raise exception 'cron jobid 86 (mon-p0-fast-lane) not found - refusing to guess at the P0 lane';
  end if;

  -- Already correct (the common case, including right now): assert and stop. Never re-paste.
  if position('mon_run_p0_detectors' in v_cmd) > 0 then
    if position(c_needle in v_cmd) = 0 then
      raise exception 'jobid 86 runs detection but no longer dispatches - the lane is half-wired';
    end if;
    if position('mon_run_p0_detectors' in v_cmd) > position(c_needle in v_cmd) then
      raise exception 'jobid 86 dispatches BEFORE it detects - a P0 found now waits a full cadence gap';
    end if;
    raise notice 'jobid 86 already derives correctly - no change';
    return;
  end if;

  if position(c_needle in v_cmd) = 0 then
    raise exception 'jobid 86 does not contain the dispatch needle - refusing to edit blind';
  end if;

  -- DERIVED, not pasted: everything else in the live command survives verbatim.
  v_new := replace(v_cmd, c_needle, c_insert);

  perform cron.alter_job(job_id := 86, command := v_new);

  if (select schedule from cron.job where jobid = 86) is distinct from v_sched_before then
    raise exception 'jobid 86 schedule changed - that is owner-only and was not intended';
  end if;
  raise notice 'jobid 86: detection chained by derivation; schedule unchanged (%)', v_sched_before;
end $derive$;

-- Prove the live lane is still exactly what it should be, whichever path ran above.
do $assert$
declare v_cmd text;
begin
  select command into v_cmd from cron.job where jobid = 86;
  if position('mon_run_p0_detectors' in v_cmd) = 0
     or position('mon_dispatch_p0_fast' in v_cmd) = 0
     or position('mon_run_p0_detectors' in v_cmd) > position('mon_dispatch_p0_fast' in v_cmd) then
    raise exception 'P0 lane is not detect-then-dispatch after this migration: %', v_cmd;
  end if;
end $assert$;
