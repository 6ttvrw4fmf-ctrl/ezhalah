-- CORRECTION, same run, same day the barrier was written. The first version of
-- mon_detect_loc_rel_table_never_completes() keyed its cohort on `last_run_at <
-- now() - interval '6 hours'` and READ 0 on a condition that was demonstrably true
-- (both aqarcity tables have never once completed). The reason is SS24b exactly:
-- last_run_at is written and committed by the tick at the START of the attempt, so a
-- table that fails every time still has its last_run_at refreshed on every rotation.
-- With 65 scope tables at one per 15 minutes the rotation is ~16.25 h, so
-- last_run_at can NEVER exceed ~16 h and a 6 h window made membership depend on
-- where in the rotation the sweep happened to be -- the barrier was measuring the
-- SCHEDULE, not the failure.
--
-- The fix is the one SS24b prescribes: measure the thing being protected. `last_ok_at`
-- is written ONLY on the success path, so "never completed" becomes NULL and stays
-- NULL, which no rotation can clear.
--
-- Backfill is exact rather than assumed: a row whose last_status is already 'ok' has
-- last_run_at == the moment it succeeded, so that value IS its last_ok_at. Every other
-- row is left NULL -- honestly "no recorded success", not a guess.

alter table public.loc_rel_refresh_state
  add column if not exists last_ok_at timestamptz;

comment on column public.loc_rel_refresh_state.last_ok_at is
  'Set ONLY when a refresh actually completes. last_run_at is committed at the top of '
  'every attempt (including ones that die at the statement_timeout), so it cannot '
  'distinguish "running" from "never finishes" -- this column can. NULL = no recorded '
  'successful refresh, ever.';

update public.loc_rel_refresh_state
   set last_ok_at = last_run_at
 where last_status = 'ok' and last_ok_at is null;

-- loc_rel_refresh_one(): stamp last_ok_at on the success path only.
do $do$
declare src text; o text; nw text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'loc_rel_refresh_one';

  o := 'now(), ''ok'', v_limit, v_ms)';
  nw := 'now(), ''ok'', v_limit, v_ms, now())';
  if position(o in src) = 0 then
    raise exception 'success-path insert not in the expected shape - refusing to patch blindly';
  end if;
  src := replace(src, o, nw);
  src := replace(src,
    'batch_limit, last_duration_ms)
    values (p_src, v_active,',
    'batch_limit, last_duration_ms, last_ok_at)
    values (p_src, v_active,');
  src := replace(src,
    'batch_limit = excluded.batch_limit, last_duration_ms = excluded.last_duration_ms;',
    'batch_limit = excluded.batch_limit, last_duration_ms = excluded.last_duration_ms,
        last_ok_at = excluded.last_ok_at;');
  execute src;
end
$do$;

create or replace function public.mon_detect_loc_rel_table_never_completes()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_rows jsonb;
  v_keys text[];
  n int := 0;
begin
  -- Cohort keys on LAST SUCCESS, never on last attempt. 65 scope tables at one tick
  -- per 15 min = a ~16.25 h rotation, so a healthy table succeeds roughly twice a day;
  -- 40 h is two full rotations plus slack, and a table that has NEVER succeeded
  -- (last_ok_at IS NULL) qualifies immediately and cannot age out.
  select coalesce(jsonb_agg(jsonb_build_object(
           'source_table', source_table, 'last_status', last_status,
           'last_ok_at', last_ok_at, 'last_run_at', last_run_at,
           'last_error', left(coalesce(last_error, ''), 200),
           'batch_limit', batch_limit,
           'last_duration_ms', round(coalesce(last_duration_ms, 0)))), '[]'::jsonb),
         coalesce(array_agg(source_table), '{}')
    into v_rows, v_keys
    from public.loc_rel_refresh_state
   where last_status is distinct from 'skipped_prune_guard'
     and (last_ok_at is null or last_ok_at < now() - interval '40 hours');

  if array_length(v_keys, 1) > 0 then
    n := n + public.mon_raise('P1', 'loc_rel_never_completes', 'location',
      'loc_rel_never_completes',
      jsonb_build_object(
        'tables', v_rows,
        'why', 'these tables'' location-relation refresh has not COMPLETED in over 40 hours '
            || '(last_ok_at NULL means it has never completed at all). last_status is '
            || 'committed as ''running'' at the top of every tick, so a tick killed by '
            || 'statement_timeout leaves ''running'' standing forever: the table is retried '
            || 'once per ~16 h rotation, dies again, and writes nothing. Its rows stay in '
            || 'search but their district/city relation signals go stale and new rows never '
            || 'get any.',
        'adjudicate', 'compare last_duration_ms against the ambient statement_timeout (120s). '
            || 'At the ceiling the batch_limit is too large for this table''s per-row cost -- '
            || 'loc_rel_refresh_one() halves it on the next SUCCESSFUL run, so a table stuck '
            || 'at the ceiling has never had one and needs batch_limit seeded down by hand. '
            || 'Do NOT prefix a SET on jobid 22: loc_rel_refresh_tick() is a PROCEDURE with '
            || 'internal COMMIT and must be the sole top-level statement (20260812115022).'));
  end if;

  perform public.mon_resolve_stale_keys('loc_rel_never_completes',
    case when array_length(v_keys, 1) > 0
         then array['loc_rel_never_completes'] else '{}'::text[] end);

  return n;
end
$fn$;

comment on function public.mon_detect_loc_rel_table_never_completes() is
  'P1: a loc_rel scope table with no COMPLETED refresh in 40h (or ever). Written '
  '2026-08-25 after both aqarcity tables were found permanently stuck in ''running'' -- '
  'every tick killed at the 120s ceiling, 238 rows never reaching loc_rel_processed, '
  'and the only symptom a generic cron_health flapping alert. Its FIRST version keyed '
  'on last_run_at and read 0 on that live failure, because the failing tick refreshes '
  'last_run_at itself (SS24b) -- it keys on last_ok_at for exactly that reason. '
  'Measured cost: <20 ms.';
