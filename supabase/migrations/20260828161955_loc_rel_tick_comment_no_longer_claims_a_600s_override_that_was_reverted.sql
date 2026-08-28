-- COMMENT-ONLY CHANGE. The procedure body is byte-identical apart from the header text.
--
-- loc_rel_refresh_tick() carried a comment asserting: "The real 600s override now lives on
-- cron.job.command (jobid 22), prefixed ahead of the CALL as its own top-level statement, which
-- DOES work." That was falsified and REVERTED three minutes after it was written, on 2026-08-12,
-- by migration 20260812115022 -- because this is a PROCEDURE with an internal COMMIT, and Postgres
-- permits that only when CALL is the SOLE top-level statement of its transaction. Prefixing a SET
-- reproduces the 2026-08-06 "invalid transaction termination" outage, which is why
-- scripts/verify-loc-rel-tick-single-statement-cron.ts exists to pin the single-statement form.
--
-- The comment was never updated, so for 16 days the function documented, as live and working, the
-- exact change that a regression test forbids. Today's Data Integrity run followed it and came one
-- step from re-applying it. A stale comment that points at a known outage is a live trap, not
-- documentation -- this corrects it in place rather than leaving the next reader to re-derive it.
--
-- The effective ceiling on this tick is the ambient statement_timeout of 120s from the
-- configuration file (measured: the 2026-08-28 09:34 failure lasted exactly 120.001s). The
-- `set local statement_timeout` line below does NOT raise it and must not be relied on for
-- headroom. Headroom comes from the work being cheap enough -- see
-- loc_rel_upsert_pushes_batch_ids_into_native_location_v2 (2026-08-28), which restored this table
-- from "times out at 120s every rotation" to 8.1s.

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

  select sc.source_table into v_src
  from loc_rel_scope_tables() sc
  left join loc_rel_refresh_state rs on rs.source_table = sc.source_table
  order by rs.last_run_at asc nulls first
  limit 1;

  if v_src is null then return; end if;

  insert into loc_rel_refresh_state (source_table, last_run_at, last_status)
  values (v_src, now(), 'running')
  on conflict on constraint loc_rel_refresh_state_pkey do update
    set last_run_at = now(), last_status = 'running';
  commit;

  -- STATEMENT TIMEOUT (corrected 2026-08-12, re-corrected 2026-08-28): a nested SET LOCAL here does
  -- NOT extend the timeout for this pg_cron-triggered CALL -- measured and disproved (GH #505).
  -- There is NO 600s override on cron.job.command (jobid 22) and there must not be: this is a
  -- PROCEDURE with an internal COMMIT, so the CALL must be the SOLE top-level statement, and a SET
  -- prefix reproduces the 2026-08-06 "invalid transaction termination" outage (reverted by
  -- 20260812115022, pinned by scripts/verify-loc-rel-tick-single-statement-cron.ts).
  -- The real ceiling is therefore the ambient 120s. Keep the per-table work well under it.
  set local statement_timeout = '110s';
  perform loc_rel_refresh_one(v_src);
  commit;
end $procedure$;
