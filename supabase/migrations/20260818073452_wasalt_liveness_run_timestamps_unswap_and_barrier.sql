-- Data Integrity run #29 (2026-08-18): a run log that says it finished before it started.
--
-- scrapers/wasalt/liveness.py wrote `finished_at = now_iso` on all three inserts, and `now_iso` is
-- captured at the TOP of the run (it is the "seen" stamp for row writes). `started_at` was never
-- sent, so it fell to its now() column default — evaluated at INSERT time, i.e. at the END. Every
-- one of the 52 rows recorded the two timestamps backwards, exactly one runtime apart:
--
--   id 52  started_at 01:57:37  finished_at 01:27:57  gap 1779.7s  notes runtime_s=1779.6
--
-- This is the ONLY audit record of the enum-strike sweep that inactivates listings in bulk (869 on
-- 2026-08-18, source-confirmed by HEAD->GET). A freshness monitor written against finished_at would
-- read one full runtime too early, every duration is negative, and "when did we last confirm wasalt
-- liveness?" could not be answered correctly from our own data.
--
-- The repair is a proven SWAP, not a guess. For all 52 rows the recorded gap equals the runtime the
-- run printed into its own notes, within the setup time between `started = time.time()` and
-- `now_iso` (delta range -0.56s .. +3.88s across 52 rows). Rows outside a generous [-2s, +5s]
-- window are NOT touched.
--
-- Code fix + regression test ship together (scrapers/wasalt/liveness.py, three insert sites;
-- scrapers/common/tests/test_wasalt_liveness_run_timestamps.py, AST, fails on the old code).

do $$
declare
  swapped int;
  ctl_scrape_runs int;
  r record;
begin
  -- Control BEFORE (§21): scrape_runs writes its timestamps correctly. If a "repair" ever touches
  -- it, this number moves and the migration must fail rather than sweep.
  select count(*) into ctl_scrape_runs from public.scrape_runs
   where finished_at is not null and finished_at < started_at;
  if ctl_scrape_runs <> 0 then
    raise exception 'control violated BEFORE repair: scrape_runs already has % inverted rows', ctl_scrape_runs;
  end if;

  with provable as (
    select id, started_at, finished_at
      from public.wasalt_liveness_runs
     where started_at > finished_at
       and notes ~ 'runtime_s=[0-9.]+'
       and ((substring(notes from 'runtime_s=([0-9.]+)'))::numeric
            - extract(epoch from (started_at - finished_at))::numeric) between -2 and 5
  )
  update public.wasalt_liveness_runs w
     set started_at = p.finished_at,      -- now_iso, captured at the top of the run
         finished_at = p.started_at       -- the now() default, stamped when the row was inserted
    from provable p
   where w.id = p.id;
  get diagnostics swapped = row_count;

  if swapped <> 52 then
    raise exception 'expected to swap all 52 provable rows, swapped %', swapped;
  end if;

  -- Pinned row (§21): id 52 is the 2026-08-18 enum-strike that inactivated 869 listings.
  select started_at, finished_at into r from public.wasalt_liveness_runs where id = 52;
  if r.started_at <> timestamptz '2026-08-18 01:27:57.679681+00'
     or r.finished_at <> timestamptz '2026-08-18 01:57:37.365547+00' then
    raise exception 'pinned row 52 did not land on its proven values: start=% finish=%',
      r.started_at, r.finished_at;
  end if;

  if exists (select 1 from public.wasalt_liveness_runs
              where finished_at is not null and finished_at < started_at) then
    raise exception 'inverted rows remain after the repair';
  end if;

  -- Control AFTER: untouched.
  select count(*) into ctl_scrape_runs from public.scrape_runs
   where finished_at is not null and finished_at < started_at;
  if ctl_scrape_runs <> 0 then
    raise exception 'control violated AFTER repair: the repair reached scrape_runs';
  end if;
end $$;

-- ── Barrier for the class, not the instance ─────────────────────────────────────────────────────
-- Not "wasalt's liveness log is inverted" but "a run log asserts it finished before it started".
-- Every table carrying both columns is enumerated, so a NEW run log with the same bug is caught
-- without anyone remembering to extend this.
create or replace function public.mon_detect_run_log_timestamps_inverted()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  rec record;
  cnt int;
  bad jsonb := '[]'::jsonb;
  total int := 0;
begin
  for rec in
    select c1.table_name as t
      from information_schema.columns c1
      join information_schema.columns c2
        on c2.table_schema = c1.table_schema and c2.table_name = c1.table_name
     where c1.table_schema = 'public'
       and c1.column_name = 'started_at' and c2.column_name = 'finished_at'
       and c1.table_name in (select table_name from information_schema.tables
                              where table_schema = 'public' and table_type = 'BASE TABLE')
     order by 1
  loop
    execute format(
      'select count(*) from public.%I where finished_at is not null and finished_at < started_at',
      rec.t) into cnt;
    if coalesce(cnt, 0) > 0 then
      total := total + cnt;
      bad := bad || jsonb_build_object('table', rec.t, 'inverted_rows', cnt);
    end if;
  end loop;

  if total > 0 then
    n := public.mon_raise('P2', 'run_log_timestamps_inverted', 'all', 'run_log_timestamps_inverted',
      jsonb_build_object(
        'inverted_total', total,
        'tables', bad,
        'why', 'A run log row says it finished BEFORE it started. The 2026-08-18 case: '
               'wasalt_liveness_runs sent finished_at = the stamp captured at the TOP of the run and '
               'left started_at to its now() column default, evaluated at INSERT time - so all 52 rows '
               'were backwards by exactly one runtime. These tables are the audit record for sweeps '
               'that inactivate listings in bulk, so a freshness or duration check reading them '
               'silently reads the wrong direction.',
        'adjudicate', 'Find the writer before touching data. A swap is only provable when the gap '
                      'matches a runtime the run recorded itself; repair what you can prove and leave '
                      'the rest. Fix the writer in the same change, or the next run re-creates the row.'));
  else
    perform public.mon_resolve_key('run_log_timestamps_inverted', 'run_log_timestamps_inverted');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_run_log_timestamps_inverted() is
  'P2. Any public BASE TABLE carrying both started_at and finished_at is checked for rows that '
  'finished before they started. Added by Data Integrity run #29 after wasalt_liveness_runs was '
  'found 52/52 backwards (finished_at = run start, started_at = insert time) while scrape_runs '
  '(30,868 rows, 0 inverted) proved the shape was writer-specific, not universal. Enumerates tables '
  'dynamically so a future run log inherits the barrier without an edit.';

-- Roster wiring, in the SAME migration: a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors would raise on it. Guarded needle-edit, never a re-pasted body.
do $do$
declare
  src text;
  before_n int;
  after_n int;
  anchor text := '''mon_detect_orphaned_detectors''';
  needle text := ', ''mon_detect_run_log_timestamps_inverted''';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to wire blindly';
  end if;

  if position('mon_detect_run_log_timestamps_inverted' in src) > 0 then
    raise notice 'already wired - no-op';
    return;
  end if;

  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1 - refusing to splice',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, anchor || needle);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');

  if after_n <> before_n + 1 then
    raise exception 'roster went from % to % entries, expected exactly +1 - refusing to install',
      before_n, after_n;
  end if;

  if position('mon_detect_run_log_timestamps_inverted' in src) = 0
     or position('mon_detect_discarded_location_resolution' in src) = 0
     or position('mon_detect_orphaned_detectors' in src) = 0
     or position('mon_detect_stalled_daily_detector' in src) = 0 then
    raise exception 'post-splice assertion failed - refusing to install';
  end if;

  execute src;
end
$do$;
