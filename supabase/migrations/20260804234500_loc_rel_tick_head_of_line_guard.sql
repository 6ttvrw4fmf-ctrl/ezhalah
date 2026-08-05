-- 2026-08-05: fix head-of-line blocking in the loc_rel refresh rotation.
--
-- INCIDENT: at 23:15 UTC 2026-08-04 `refresh-loc-rel-signals` began failing with
--   ERROR: canceling statement due to statement timeout
-- on dealapp_commercial_listings, and then failed identically at 23:30. Every run after that
-- would have failed the same way, forever.
--
-- WHY IT JAMS THE WHOLE FLEET: loc_rel_refresh_tick() picks the LEAST recently refreshed table.
-- loc_rel_refresh_one() does have an `exception when others` handler that stamps last_run_at, so
-- an ordinary error advances the rotation correctly. A STATEMENT TIMEOUT does not: it cancels the
-- whole outer statement, so the handler's own INSERT is cancelled too and last_run_at is never
-- written. The table therefore stays "least recently refreshed" and is re-picked on every tick --
-- starving all ~64 other source tables indefinitely. Observed: dealapp last_run_at frozen at
-- 07:00 while the clock passed 23:32.
--
-- FIX: stamp the attempt and COMMIT *before* doing the work. Forward progress no longer depends on
-- the work succeeding, so no single slow table can ever monopolise the rotation again. A table that
-- times out is simply retried on the next full cycle instead of every 15 minutes.
--
-- This does NOT paper over the underlying slowness -- a table left in 'running' is a visible signal
-- that its refresh never completed, and the 18 unprocessed dealapp rows remain to be diagnosed.
-- It only stops one slow table taking the other 63 down with it.
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

  perform loc_rel_refresh_one(v_src);
  commit;
end $procedure$;
