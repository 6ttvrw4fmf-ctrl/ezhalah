-- BOTH aqarcity loc_rel refreshes have NEVER completed. loc_rel_refresh_state has
-- read last_status='running' for aqarcity_residential_listings and
-- aqarcity_commercial_listings continuously -- 'running' is written at the TOP of
-- the tick and committed, and only a SUCCESSFUL finish overwrites it. jobid 22 dies
-- at exactly 120.0s (the ambient statement_timeout; the single-statement cron
-- command is deliberate and regression-tested -- prefixing a SET reproduces the
-- 2026-08-06 "invalid transaction termination" outage, see 20260812115022).
--
-- MECHANISM, and it is self-sustaining: the dirty batch is capped at 2500 rows
-- (bounded 2026-08-12 for dealapp), but aqarcity's per-row cost is ~10x dealapp's
-- because extract_location_relations_for() runs over ~12 KB source_capture blobs --
-- measured today: 200 rows did not finish in 60s, i.e. >=300 ms/row. aqarcity has
-- 1,768 production_ready candidates and re-dirties ALL of them on every daily crawl
-- (the dirty test is `t.scraped_at > p.processed_at`, and processed_at only advances
-- on success). So every tick tries ~1,768 rows, needs ~9 minutes, gets 120 seconds,
-- and writes nothing -- forever. 238 rows have never reached loc_rel_processed at all.
--
-- FIX 1: the cap becomes per-table and SELF-TUNING from measured runtime, so no
-- future table needs a hand-picked constant (SS23b: never resolve a threshold from a
-- number you could not read). A run that spends >60% of the working budget halves its
-- own limit; one under 20% doubles it, capped at the original 2500. aqarcity is seeded
-- at 250 so it makes forward progress on the very next tick instead of converging from
-- a limit it can never complete.
--
-- FIX 2: nothing in the system could see this. cron_health only reported jobid 22
-- "flapping" -- generic, and indistinguishable from contention. There was no barrier
-- asking the one question that mattered: has this table's refresh EVER finished?
-- mon_detect_loc_rel_table_never_completes() asks exactly that.

alter table public.loc_rel_refresh_state
  add column if not exists batch_limit      int,
  add column if not exists last_duration_ms numeric;

comment on column public.loc_rel_refresh_state.batch_limit is
  'Per-table dirty-batch cap, self-tuned by loc_rel_refresh_one() from the previous '
  'run''s measured duration. NULL = the 2500 default. Halves above 60% of the working '
  'budget, doubles below 20%, never exceeds 2500 and never drops below 50.';

do $do$
declare
  src text;
  a_old text; a_new text;
  b_old text; b_new text;
  d_old text; d_new text;
  s_old text; s_new text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'loc_rel_refresh_one';
  if src is null then raise exception 'loc_rel_refresh_one() not found'; end if;

  -- declare block: batch limit + run clock
  d_old := '  r record; v_active bigint; v_prior bigint; v_del bigint; v_dirty bigint; v_ids bigint[];
  v_dirty_sql text;';
  d_new := '  r record; v_active bigint; v_prior bigint; v_del bigint; v_dirty bigint; v_ids bigint[];
  v_dirty_sql text;
  v_limit int; v_t0 timestamptz := clock_timestamp(); v_ms numeric; v_budget_ms numeric := 100000;';

  -- branch 1 (tables with scraped_at, incl. aqarcity): parameterise the cap
  a_old := '        limit 2500
      ) x
    $f$, p_src, p_src, p_src, p_src);';
  a_new := '        limit %s
      ) x
    $f$, p_src, p_src, p_src, p_src, v_limit);';

  -- branch 2 (hash-diffed tables): same cap, same source
  b_old := '        limit 2500
      )
      select coalesce(array_agg(id), ''{}'') from dirty
    $f$, case when r.has_capture then ''t.source_capture'' else ''null::jsonb'' end,
         p_src, p_src, p_src, p_src);';
  b_new := '        limit %s
      )
      select coalesce(array_agg(id), ''{}'') from dirty
    $f$, case when r.has_capture then ''t.source_capture'' else ''null::jsonb'' end,
         p_src, p_src, p_src, p_src, v_limit);';

  -- success path: measure, adapt, and record both
  s_old := '  insert into loc_rel_refresh_state
    (source_table, last_active_count, last_signal_count, last_run_at, last_status)
    values (p_src, v_active,
            (select count(*) from listing_location_relations llr where llr.source_table = p_src),
            now(), ''ok'')
  on conflict on constraint loc_rel_refresh_state_pkey do update
    set last_active_count = excluded.last_active_count,
        last_signal_count = excluded.last_signal_count,
        last_run_at = now(), last_status = ''ok'', last_error = null;';
  s_new := '  v_ms := extract(epoch from clock_timestamp() - v_t0) * 1000;
  -- Self-tuning cap. Only a run that actually did a full batch of work is evidence
  -- about throughput, so a short batch never inflates the limit.
  if v_ms > 0.6 * v_budget_ms then
    v_limit := greatest(50, (v_limit / 2)::int);
  elsif v_ms < 0.2 * v_budget_ms and v_dirty >= v_limit then
    v_limit := least(2500, v_limit * 2);
  end if;

  insert into loc_rel_refresh_state
    (source_table, last_active_count, last_signal_count, last_run_at, last_status,
     batch_limit, last_duration_ms)
    values (p_src, v_active,
            (select count(*) from listing_location_relations llr where llr.source_table = p_src),
            now(), ''ok'', v_limit, v_ms)
  on conflict on constraint loc_rel_refresh_state_pkey do update
    set last_active_count = excluded.last_active_count,
        last_signal_count = excluded.last_signal_count,
        last_run_at = now(), last_status = ''ok'', last_error = null,
        batch_limit = excluded.batch_limit, last_duration_ms = excluded.last_duration_ms;';

  if position(d_old in src) = 0 or position(a_old in src) = 0
     or position(b_old in src) = 0 or position(s_old in src) = 0 then
    raise exception 'loc_rel_refresh_one() is not in the expected shape - refusing to patch blindly';
  end if;

  src := replace(src, d_old, d_new);
  src := replace(src, a_old, a_new);
  src := replace(src, b_old, b_new);
  src := replace(src, s_old, s_new);

  -- v_limit must be resolved before either dirty SQL is built.
  src := replace(src,
    '  select count(*) into v_active',
    '  select coalesce(batch_limit, 2500) into v_limit
    from loc_rel_refresh_state where source_table = p_src;
  v_limit := coalesce(v_limit, 2500);

  select count(*) into v_active');

  execute src;
end
$do$;

-- Seed the two tables that provably cannot complete at 2500.
insert into public.loc_rel_refresh_state (source_table, batch_limit)
values ('aqarcity_residential_listings', 250), ('aqarcity_commercial_listings', 250)
on conflict on constraint loc_rel_refresh_state_pkey
do update set batch_limit = excluded.batch_limit;

-- BARRIER --------------------------------------------------------------------
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
  -- A table whose refresh has not reached 'ok' for over 6 hours. 'running' is the
  -- dangerous value: it is written and COMMITTED at the top of the tick, so a tick
  -- that is killed leaves 'running' behind forever and every point-in-time read of
  -- this table looks like work in progress rather than work that never happens.
  select coalesce(jsonb_agg(jsonb_build_object(
           'source_table', source_table, 'last_status', last_status,
           'last_run_at', last_run_at, 'last_error', left(coalesce(last_error,''), 200),
           'batch_limit', batch_limit, 'last_duration_ms', round(coalesce(last_duration_ms,0)))), '[]'::jsonb),
         coalesce(array_agg(source_table), '{}')
    into v_rows, v_keys
    from public.loc_rel_refresh_state
   where last_status is distinct from 'ok'
     and last_status is distinct from 'skipped_prune_guard'
     and last_run_at < now() - interval '6 hours';

  if array_length(v_keys, 1) > 0 then
    n := n + public.mon_raise('P1', 'loc_rel_never_completes', 'location',
      'loc_rel_never_completes',
      jsonb_build_object(
        'tables', v_rows,
        'why', 'these tables'' location-relation refresh has not COMPLETED in over 6 hours. '
            || 'last_status is committed as ''running'' at the top of every tick, so a tick '
            || 'killed by statement_timeout leaves ''running'' standing forever -- the table '
            || 'is retried once per full rotation, dies again, and writes nothing. Their rows '
            || 'stay in search but their district/city relation signals go stale and new rows '
            || 'never get any.',
        'adjudicate', 'compare last_duration_ms against the ambient statement_timeout (120s). '
            || 'If the run is hitting the ceiling, the batch_limit is too large for this '
            || 'table''s per-row cost -- loc_rel_refresh_one() halves it automatically on the '
            || 'next SUCCESSFUL run, so a table stuck at the ceiling has never had one and '
            || 'needs its batch_limit seeded down by hand. Do NOT prefix a SET on jobid 22: '
            || 'loc_rel_refresh_tick() is a PROCEDURE with internal COMMIT and must be the '
            || 'sole top-level statement (migration 20260812115022).'));
  end if;

  -- Raise and resolve share ONE predicate and the live key set is derived from the
  -- cohort that raises (SS25a) -- never a second, independently-worded self-heal.
  perform public.mon_resolve_stale_keys('loc_rel_never_completes',
    case when array_length(v_keys,1) > 0 then array['loc_rel_never_completes'] else '{}'::text[] end);

  return n;
end
$fn$;

comment on function public.mon_detect_loc_rel_table_never_completes() is
  'P1: a loc_rel scope table whose refresh has not reached last_status=''ok'' in 6h. '
  'Written 2026-08-25 after both aqarcity tables were found permanently stuck in '
  '''running'' -- every tick killed at the 120s ceiling, 238 rows never reaching '
  'loc_rel_processed, and the only symptom a generic cron_health flapping alert. '
  'Measured cost: <20 ms (reads one small state table).';

-- Roster: insert ONE element into the LIVE array (SS26) -- never re-emit the whole
-- roster from a snapshot, because concurrent sessions add detectors to it.
do $roster$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_loc_rel_table_never_completes' in src) > 0 then return; end if;
  if position('''mon_detect_loc_rel_capacity_risk''' in src) = 0 then
    raise exception 'anchor detector not found in roster - refusing to edit blindly';
  end if;
  src := replace(src, '''mon_detect_loc_rel_capacity_risk''',
                      '''mon_detect_loc_rel_capacity_risk'', ''mon_detect_loc_rel_table_never_completes''');
  execute src;
end
$roster$;
