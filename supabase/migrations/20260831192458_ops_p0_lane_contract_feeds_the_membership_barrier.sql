-- The read-only feed for scripts/verify-p0-fast-lane-detection.ts (routine #7, 2026-08-31,
-- issue #1408).
--
-- WHY THIS EXISTS AT ALL. 20260831192229 moved P0 detection out of the long sweep transaction and
-- into the fast lane, and the fix is a LIST: the ten detector names inside mon_run_p0_detectors().
-- Lists rot. The next engineer adds a detector that raises P0, wires it into the full-sweep roster
-- (which mon_detect_orphaned_detectors does police) and never touches the lane -- and that detector
-- silently inherits the up-to-712s latency the whole change existed to remove, with every barrier
-- still green.
--
-- So the barrier must compare the lane's list against REALITY, not against a second hardcoded list
-- in TypeScript -- a duplicated literal would just move the rot somewhere less visible. This
-- function derives "which detectors can raise P0" from pg_proc itself and hands back the lane's
-- actual array alongside it, so the two can be diffed.
--
-- COMMENTS ARE STRIPPED BEFORE MATCHING, and that is load-bearing rather than tidy. Several
-- detectors merely MENTION 'P0' in an alert's prose ("this is not a P0"), and several of the ten
-- carry long rationale comments quoting severities. Matching raw text would both over- and
-- under-report. What is matched is a P0 severity literal in EXECUTABLE source: the first argument
-- of a mon_raise call, which is the only way a P0 alert can actually be created.
--
-- Anon-executable and strictly read-only, exactly like ops_deploy_preflight_checks and
-- ops_migration_content_digests: the barrier runs on the public key in CI, and there is nothing
-- here a caller could use to change state.

create or replace function public.ops_p0_lane_contract()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with stripped as (
    -- Executable source only: drop whole-line `--` comments before looking for mon_raise('P0'.
    select p.proname,
           (select coalesce(string_agg(l, E'\n' order by o), '')
              from regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') with ordinality t(l, o)
             where l !~ '^\s*--') as src
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname like 'mon\_detect\_%'
  ),
  p0 as (
    -- mon_raise(<severity>, ...) with a P0 literal in the severity position. Tolerates the
    -- `n := n + public.mon_raise('P0', ...)` and bare `mon_raise('P0',` shapes alike.
    select proname from stripped
     where src ~ 'mon_raise\s*\(\s*''P0'''
        -- ...and the `case when ... then 'P0' else 'P1' end` severity shape.
        or src ~ 'mon_raise\s*\(\s*case[^)]*''P0'''
  ),
  lane as (
    select (select coalesce(string_agg(l, E'\n' order by o), '')
              from regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') with ordinality t(l, o)
             where l !~ '^\s*--') as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mon_run_p0_detectors'
  ),
  lane_names as (
    select m[1] as proname
      from lane, regexp_matches(lane.src, '''(mon_detect_[a-z0-9_]+)''', 'g') m
  ),
  sweep as (
    select (select coalesce(string_agg(l, E'\n' order by o), '')
              from regexp_split_to_table(pg_get_functiondef(p.oid), E'\n') with ordinality t(l, o)
             where l !~ '^\s*--') as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mon_run_all_detectors'
  ),
  job as (
    select schedule, command, active from cron.job where jobid = 86
  ),
  runs as (
    select count(*)::int as n,
           count(*) filter (where status <> 'succeeded')::int as failed,
           round(max(extract(epoch from (end_time - start_time)))::numeric, 3) as max_s
      from cron.job_run_details
     where jobid = 86 and start_time > now() - interval '24 hours'
  )
  select jsonb_build_object(
    'p0_capable_detectors', (select coalesce(jsonb_agg(proname order by proname), '[]'::jsonb) from p0),
    'lane_detectors',       (select coalesce(jsonb_agg(distinct proname), '[]'::jsonb) from lane_names),
    'lane_schedule',        (select schedule from job),
    'lane_command',         (select command from job),
    'lane_active',          (select active from job),
    'lane_runs_24h',        (select n from runs),
    'lane_failures_24h',    (select failed from runs),
    'lane_max_runtime_s',   (select max_s from runs),
    -- Defence in depth: the lane is the fast path, never the only one. If it stops, the full sweep
    -- must still find these.
    'sweep_still_has_them', (select bool_and((select src from sweep) like '%' || proname || '%') from p0)
  );
$function$;

comment on function public.ops_p0_lane_contract() is
  'Read-only feed for scripts/verify-p0-fast-lane-detection.ts (issue #1408). Derives the set of '
  'mon_detect_* functions that can raise P0 from pg_proc (whole-line comments stripped, matching a '
  'P0 literal in mon_raise''s severity argument) and returns it alongside mon_run_p0_detectors()''s '
  'actual list, cron jobid 86''s schedule/command/health, and whether the full sweep still carries '
  'the same detectors as a backstop. Exists so the lane''s membership is checked against reality '
  'rather than a duplicated hardcoded list. Anon-executable and strictly read-only.';

revoke all on function public.ops_p0_lane_contract() from public;
grant execute on function public.ops_p0_lane_contract() to anon, authenticated, service_role;
