-- THE P0-CAPABILITY PREDICATE WAS UNDER-DETECTING, WHICH IS THE DANGEROUS DIRECTION
-- (routine #7, 2026-08-31, issue #1408). Supersedes the predicate in
-- ops_p0_lane_contract_feeds_the_membership_barrier, applied minutes earlier the same run.
--
-- The first version matched a P0 literal in mon_raise's severity ARGUMENT:
--     mon_raise\s*\(\s*''P0''            and the inline case-expression variant.
-- Measured against production it found 6 detectors. The real count is 10. It missed the shape
-- these actually use, which is the commonest one in this codebase:
--
--     sev := case when dup_primary_n >= 3 then 'P0' else 'P1' end;   -- agent_calls_per_message
--     sev := case when cur_rate >= 0.50   then 'P0' else 'P1' end;   -- agent_health
--     ...
--     n := n + public.mon_raise(sev, ...)
--
-- The P0 literal is in a VARIABLE ASSIGNMENT and never appears near mon_raise at all. Any regex
-- that tries to follow that data flow is a dataflow analysis written in POSIX regex, and it will
-- lose again on the next shape someone invents.
--
-- WHICH WAY THIS IS ALLOWED TO BE WRONG. The two errors are not symmetric:
--   * UNDER-detect -> a genuinely P0-capable detector is absent from the fast lane, the barrier
--     reads green, and that detector silently keeps the up-to-712s sweep-transaction latency this
--     work exists to remove. Exactly the failure this barrier was built to prevent.
--   * OVER-detect -> a detector that only mentions P0 gets added to the lane. Cost: microseconds
--     on a lane whose entire measured worst case is 0.196s.
-- So the predicate is deliberately a conservative OVER-approximation: executable source (whole-line
-- comments stripped) contains a 'P0' literal AND calls mon_raise. Confirmed against production:
-- exactly the 10 detectors the lane already carries.
--
-- It knowingly includes two that reference P0 as DATA rather than raising it --
-- mon_detect_alert_delivery (c_delivered := array['P0','P1','P2'], a severity filter) and
-- mon_detect_unacknowledged_p0 (where severity = 'P0', reading the alerts it polices). Keeping
-- them is the point: they are cheap, and a predicate tuned to exclude them is a predicate one
-- refactor away from excluding a real one.

create or replace function public.ops_p0_lane_contract()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with stripped as (
    -- Executable source only. Stripping whole-line comments is load-bearing, not tidiness: the
    -- rationale comments in these functions quote severities constantly, and matching raw text
    -- would report half the roster as P0-capable.
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
    -- Conservative by design -- see the header. A P0 literal anywhere in executable source, in a
    -- function that can raise. Catches the `sev := case ... 'P0' ... end; mon_raise(sev, ...)`
    -- shape that a severity-argument regex cannot follow.
    select proname from stripped
     where src ~ '''P0''' and src ~ 'mon_raise'
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
    'sweep_still_has_them', (select bool_and((select src from sweep) like '%' || proname || '%') from p0)
  );
$function$;

comment on function public.ops_p0_lane_contract() is
  'Read-only feed for scripts/verify-p0-fast-lane-detection.ts (issue #1408). Derives which '
  'mon_detect_* functions are P0-capable from pg_proc -- whole-line comments stripped, then a '
  'deliberately CONSERVATIVE predicate (a P0 literal in executable source of a function that calls '
  'mon_raise), because under-detecting leaves a detector stuck behind the 712s sweep transaction '
  'while over-detecting costs microseconds on a 0.196s lane. Returns it beside '
  'mon_run_p0_detectors()''s actual list, cron jobid 86''s schedule/command/health, and whether the '
  'full sweep still carries the same detectors as a backstop. Anon-executable and read-only.';

do $verify$
declare v jsonb; n_p0 int; n_missing int;
begin
  v := public.ops_p0_lane_contract();
  select jsonb_array_length(v->'p0_capable_detectors') into n_p0;
  select count(*) into n_missing
    from jsonb_array_elements_text(v->'p0_capable_detectors') d
   where not (v->'lane_detectors' ? d);
  if n_p0 < 10 then
    raise exception 'P0-capability predicate found only % detectors - it is under-detecting again', n_p0;
  end if;
  if n_missing > 0 then
    raise exception '% P0-capable detector(s) are not on the fast lane', n_missing;
  end if;
  raise notice 'p0 lane contract: % P0-capable detectors, all on the lane', n_p0;
end $verify$;
