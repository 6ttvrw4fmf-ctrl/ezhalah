-- The twice-hourly detector sweep (jobid 38) has been KILLED by its own
-- statement_timeout 2-3 times a day since 2026-08-20 (900.0s exactly), while its
-- median runtime grew 42s -> 224s in seven days. pg_cron runs the whole command in
-- ONE transaction, so each abort rolls back EVERY alert the sweep already raised
-- AND skips mon_dispatch_alerts entirely: a half-hour with nothing monitored and
-- nothing dispatched, leaving no trace outside cron.job_run_details.
--
-- Two defects, and the second is why the first was never fixed:
--
--   1. NO SOFT DEADLINE. 111 detectors run serially in one statement under one
--      hard ceiling. Detector #111 being slow destroys the work of detectors
--      #1-#110. An all-or-nothing sweep is the worst possible failure mode for a
--      monitoring layer -- the same wound as SS23a/24b/25a: a safety mechanism
--      that cannot fail loudly.
--   2. NO ATTRIBUTION. mon_detect_detector_sweep_budget()'s own action line says
--      "attribute the runtime per detector", but nothing recorded per-detector
--      timing and pg_stat_statements.track='top' does not see nested calls. The
--      barrier could say "too slow" and never "which one".
--
-- This rewrites ONLY the loop and the declare block. The fns array is carried over
-- from the LIVE function text, never re-emitted from a snapshot -- concurrent
-- sessions add detectors to this roster (SS26), and a wholesale CREATE OR REPLACE
-- from a stale copy would silently drop theirs.
do $do$
declare
  src text;
  old_decl text;
  new_decl text;
  old_loop text;
  new_loop text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors() not found';
  end if;

  old_decl := '  fn text; raised int; result jsonb := ''{}''::jsonb; failed text[] := ''{}'';';
  if position(old_decl in src) = 0 then
    raise exception 'declare block not in the expected shape - refusing to patch blindly';
  end if;

  new_decl := $nb$  fn text; raised int; result jsonb := '{}'::jsonb; failed text[] := '{}';
  v_started  timestamptz := clock_timestamp();
  v_t0       timestamptz;
  v_ms       numeric;
  v_budget_s numeric;
  v_soft_s   numeric;
  v_skipped  text[] := '{}';
  v_elapsed  numeric;$nb$;

  old_loop := '  foreach fn in array fns loop';
  if position(old_loop in src) = 0 then
    raise exception 'loop header not in the expected shape - refusing to patch blindly';
  end if;

  -- Soft deadline: 75% of the sweep's OWN declared ceiling, read from the cron
  -- command exactly the way mon_detect_detector_sweep_budget() reads it, so the
  -- two can never disagree about what the budget is. Unreadable -> 900s default,
  -- which is the current declared value; this never fails OPEN into "no limit".
  new_loop := $nb$  v_budget_s := coalesce(
    (select nullif(substring(command from 'statement_timeout\s+to\s+''(\d+)s'''), '')::numeric
       from cron.job where jobname = 'mon-detectors-and-dispatch'), 900);
  v_soft_s := 0.75 * v_budget_s;

  foreach fn in array fns loop
    -- SOFT DEADLINE. Stop calling detectors while there is still budget to COMMIT
    -- in. Half a sweep plus a dispatched alert naming the gap beats a whole sweep
    -- rolled back in silence.
    if extract(epoch from clock_timestamp() - v_started) > v_soft_s then
      v_skipped := v_skipped || fn;
      insert into public.ops_detector_timing (detector, elapsed_ms, raised, skipped)
        values (fn, 0, null, true);
      continue;
    end if;$nb$;

  src := replace(src, old_decl, new_decl);
  src := replace(src, old_loop, new_loop);

  -- Per-detector timing on the success path.
  src := replace(src,
    '      execute format(''select public.%I()'', fn) into raised;
      result := result || jsonb_build_object(replace(fn, ''mon_detect_'', ''''), raised);',
    $nb$      v_t0 := clock_timestamp();
      execute format('select public.%I()', fn) into raised;
      v_ms := extract(epoch from clock_timestamp() - v_t0) * 1000;
      insert into public.ops_detector_timing (detector, elapsed_ms, raised)
        values (fn, v_ms, raised);
      result := result || jsonb_build_object(replace(fn, 'mon_detect_', ''), raised);$nb$);

  -- ... and on the crash path, so a detector that dies slowly is still attributable.
  src := replace(src,
    '      failed := failed || fn;',
    $nb$      failed := failed || fn;
      begin
        insert into public.ops_detector_timing (detector, elapsed_ms, crashed)
          values (fn, extract(epoch from clock_timestamp() - v_t0) * 1000, true);
      exception when others then null;
      end;$nb$);

  -- After the loop: raise on anything the deadline cut, and retain 14 days.
  src := replace(src,
    '  end loop;',
    $nb$  end loop;

  v_elapsed := extract(epoch from clock_timestamp() - v_started);

  -- A skipped detector protected NOTHING this half-hour. That must be loud, and it
  -- must be able to go GREEN again on its own (SS23a) -- mon_raise/mon_resolve_key
  -- on one stable dedup key does both.
  if array_length(v_skipped, 1) > 0 then
    perform public.mon_raise('P1', 'detector_sweep_budget', 'monitoring',
      'detector_sweep_soft_deadline',
      jsonb_build_object(
        'skipped_count', array_length(v_skipped, 1),
        'skipped', to_jsonb(v_skipped),
        'elapsed_s', round(v_elapsed),
        'soft_deadline_s', v_soft_s,
        'declared_budget_s', v_budget_s,
        'why', 'the sweep ran out of its soft budget and these detectors did not run at '
            || 'all this half-hour. They are NOT green - they are unmeasured. The sweep '
            || 'stopped deliberately so the alerts it had already raised could COMMIT and '
            || 'mon_dispatch_alerts could still run, instead of the whole transaction '
            || 'being rolled back by statement_timeout.',
        'action', 'attribute with: select detector, round(avg(elapsed_ms)) ms, count(*) '
            || 'from ops_detector_timing where swept_at > now() - interval ''24 hours'' '
            || 'and not skipped group by 1 order by 2 desc limit 10;'));
  else
    perform public.mon_resolve_key('detector_sweep_budget', 'detector_sweep_soft_deadline');
  end if;

  delete from public.ops_detector_timing where swept_at < now() - interval '14 days';$nb$);

  execute src;
end
$do$;

comment on function public.mon_run_all_detectors() is
  'Runs every detector in the roster. Returns a count per detector plus `failed` and '
  '`open_alerts` -- READ BOTH (SS11a): a count is newly-raised, not standing state. '
  'Since 2026-08-25 it also (a) records per-detector runtime in ops_detector_timing on '
  'every committed sweep, and (b) stops at a SOFT deadline of 75% of the cron job''s own '
  'statement_timeout, raising detector_sweep_soft_deadline with the exact list it skipped. '
  'Measured cost of the timing writes: ~111 inserts per sweep, under 100 ms total. '
  'Do NOT re-emit the fns array from a snapshot when editing this function -- concurrent '
  'sessions add detectors to it; patch the live text (see migration 20260825_ for how).';
