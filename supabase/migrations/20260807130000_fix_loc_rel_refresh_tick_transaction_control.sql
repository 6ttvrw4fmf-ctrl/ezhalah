-- 2026-08-07: fix `refresh-loc-rel-signals` (jobid 22) — 100% failing every 15 minutes since
-- 2026-08-06 17:30 UTC (cron_health P1 alert fired 17:50 UTC, still unresolved as of this repair).
--
-- OBSERVED ERROR (cron.job_run_details, 79 consecutive failures 2026-08-05 16:00 → present):
--   ERROR:  invalid transaction termination
--   CONTEXT:  PL/pgSQL function loc_rel_refresh_tick() line 28 at COMMIT
--
-- ROOT CAUSE: at some point after the 2026-08-05 head-of-line-guard fix (which correctly shipped
-- `loc_rel_refresh_tick()` as a PROCEDURE containing two internal `commit;` calls — valid ONLY
-- when the CALL is the sole top-level statement of its own transaction), cron.job jobid 22's
-- command was changed to:
--     set statement_timeout to '600s'; call loc_rel_refresh_tick()
-- Postgres executes a multi-statement simple-query string as one implicit transaction block, so
-- the CALL is no longer the sole top-level statement — the procedure's internal `commit;` at line
-- 28 is then executed *inside* that implicit block, which PostgreSQL disallows (error 2D000,
-- "invalid transaction termination"). Confirmed by cron.job_run_details: 113 successes while the
-- command was (implicitly) single-statement, then 100% failures from 2026-08-06 17:30 onward.
-- Every table in the round-robin has been starved of refreshes since — the exact head-of-line
-- symptom the 2026-08-05 fix was meant to prevent, just from a different cause.
--
-- FIX (two parts, both required):
--   1. Move the statement_timeout INTO the procedure body via `set local`, re-asserted after each
--      internal commit (SET LOCAL only lasts to the end of the current transaction, and the
--      procedure starts a new transaction at each `commit;`). This preserves the 600s timeout
--      protection the cron command was trying to add, without breaking the CALL semantics.
--   2. Revert cron.job's command back to the single bare statement `call
--      public.loc_rel_refresh_tick()` — no leading `set ...;`.
--
-- Regression-guarded by scripts/verify-loc-rel-tick-single-statement-cron.ts (npm test): fails if
-- this file (or any future migration) re-combines a `set ...;` prefix with a CALL to this
-- procedure in the same command string, or if the procedure body loses its `set local
-- statement_timeout` protection.

create or replace procedure public.loc_rel_refresh_tick()
 language plpgsql
as $procedure$
declare
  v_src text;
begin
  if not exists (select 1 from loc_rel_processed limit 1) then
    raise exception
      'loc_rel_refresh_tick: loc_rel_processed is empty — run CALL loc_rel_backfill() first';
  end if;

  -- Pick the table that was least recently refreshed (or never refreshed).
  -- Tables never seen in loc_rel_refresh_state come first (last_run_at IS NULL).
  select sc.source_table into v_src
  from loc_rel_scope_tables() sc
  left join loc_rel_refresh_state rs on rs.source_table = sc.source_table
  order by rs.last_run_at asc nulls first
  limit 1;

  if v_src is null then return; end if;

  -- HEAD-OF-LINE GUARD (2026-08-05): claim the slot and COMMIT before starting the work.
  -- A statement timeout inside loc_rel_refresh_one cannot roll this back, so the rotation always
  -- advances. loc_rel_refresh_one overwrites this row with 'ok' (or 'error') when it completes;
  -- a row left showing 'running' means that refresh was killed mid-flight.
  insert into loc_rel_refresh_state (source_table, last_run_at, last_status)
  values (v_src, now(), 'running')
  on conflict on constraint loc_rel_refresh_state_pkey do update
    set last_run_at = now(), last_status = 'running';
  commit;

  -- STATEMENT TIMEOUT (2026-08-07 fix): applied here, INSIDE the procedure, via SET LOCAL — not
  -- as a separate statement prefixed onto the cron command. SET LOCAL is scoped to the current
  -- transaction only, so it must be re-issued in this fresh transaction (started implicitly by
  -- the commit above) rather than once at the top of the procedure.
  set local statement_timeout = '600s';
  perform loc_rel_refresh_one(v_src);
  commit;
end $procedure$;

-- Revert the cron command to the single bare statement the procedure's internal COMMITs require.
-- Looked up by jobname (not a hardcoded jobid) so this is safe to apply regardless of jobid drift.
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'refresh-loc-rel-signals';
  if v_jobid is not null then
    perform cron.alter_job(v_jobid, command => 'call public.loc_rel_refresh_tick()');
  end if;
end $$;
