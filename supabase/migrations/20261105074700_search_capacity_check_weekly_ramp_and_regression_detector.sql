-- How many people can search at the same time and still see the first card by 12 s? (owner 2026-11-05: «we don't
-- want the user to get the bug. I want us to catch it before, and focus on the root of the bug»; «12 seconds … part
-- of the journey experience; higher than that is an issue».)
--
-- .github/workflows/capacity-check.yml ramps real Filter searches 1 → 8 users once a week
-- (scripts/verify-capacity-check-live.ts). This migration gives it:
-- 1. ops_capacity_run: one row per step — data-ready p50/p95 on the user's clock, error rate, p50/p95 per call, the
--    safe number of simultaneous searches, how the ramp ended, the slowest call and the top SQL of the run.
-- 2. ops_capacity_db_activity(): the read-only pg_stat_activity look the robot takes before EVERY step (AGENTS.md
--    «our own robots must not take production down», rule 1). Counts only; never a query text.
-- 3. ops_capacity_statements(p_before): a read-only pg_stat_statements snapshot (p_before null) or the delta since
--    it (top 8 statements by time), so the report names the slowest SQL, not just the slowest call.
-- 4. mon_detect_capacity_regression(): P1 when the latest measured safe number is below the floor (the first
--    measured run minus 1, never below 2); P1 when no measured run landed for 8 days (a silent robot is an alarm —
--    a run stopped by foreign load measured nothing); P2 when the safe number dropped since the previous run.
-- Rostered into mon_run_all_detectors in this same migration and proven both ways in rolled-back sub-transactions.

create table if not exists public.ops_capacity_run (
  run_id                  uuid        not null,
  run_at                  timestamptz not null,
  step                    integer     not null,
  concurrency             integer     not null,
  seconds                 numeric,
  searches                integer     not null default 0,
  p50_ms                  integer,
  p95_ms                  integer,
  error_rate              numeric,
  verdict                 text,
  calls                   jsonb       not null default '{}',
  p95_limit_ms            integer     not null,
  p95_warn_ms             integer,
  safe_concurrency        integer,
  comfortable_concurrency integer,
  ended                   text        not null check (ended in ('limit', 'cap', 'foreign_load')),
  slowest_call            text,
  slowest_sql             jsonb,
  notes                   jsonb       not null default '{}',
  created_at              timestamptz not null default now(),
  primary key (run_id, step)
);
comment on table public.ops_capacity_run is
  'Weekly search capacity ramp, one row per step (.github/workflows/capacity-check.yml). p50_ms/p95_ms = data ready '
  'on the user''s clock (tap → results + cards in). safe_concurrency = simultaneous searches whose first card still '
  'lands by 12 s (owner 2026-11-05). ended: limit = a step failed (measured), cap = all 8 passed (lower bound), '
  'foreign_load = stopped for someone else''s load (not a measurement). Read by mon_detect_capacity_regression.';
create index if not exists ops_capacity_run_run_at on public.ops_capacity_run (run_at desc);
alter table public.ops_capacity_run enable row level security;
revoke all on public.ops_capacity_run from anon, authenticated;
grant select, insert on public.ops_capacity_run to service_role;

create or replace function public.ops_capacity_db_activity()
returns jsonb
language sql stable security definer set search_path to ''
as $function$
  select jsonb_build_object(
    'active', count(*) filter (where usename = 'authenticator' and state = 'active'),
    'slow', count(*) filter (where usename = 'authenticator' and state = 'active' and now() - query_start > interval '5 seconds'),
    'background_slow', count(*) filter (where usename is distinct from 'authenticator' and state = 'active'
                                          and backend_type = 'client backend' and now() - query_start > interval '5 seconds'),
    'robot_lane_waiting', count(*) filter (where usename = 'authenticator' and state = 'active' and wait_event = 'PgSleep'),
    'at', now())
  from pg_catalog.pg_stat_activity
  where pid <> pg_catalog.pg_backend_pid();
$function$;
comment on function public.ops_capacity_db_activity() is
  'Read-only: foreign load before each capacity-check step (authenticator active / > 5 s; background > 5 s; robots '
  'sleeping in robot_gate lanes). The caller''s own backend is excluded.';
revoke all on function public.ops_capacity_db_activity() from public, anon, authenticated;
grant execute on function public.ops_capacity_db_activity() to service_role;

create or replace function public.ops_capacity_statements(p_before jsonb default null)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare v jsonb;
begin
  if p_before is null then
    select coalesce(jsonb_object_agg(s.userid::text || ':' || s.queryid::text,
             jsonb_build_array(s.calls, round(s.total_exec_time::numeric, 1))), '{}'::jsonb)
      into v
      from extensions.pg_stat_statements s
     where s.userid in ('anon'::regrole, 'authenticated'::regrole);
    return v;
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.ms desc), '[]'::jsonb) into v from (
    select x.role, x.calls, x.ms, x.query from (
      select pg_catalog.pg_get_userbyid(s.userid)::text as role,
             s.calls - coalesce((p_before -> (s.userid::text || ':' || s.queryid::text) ->> 0)::bigint, 0) as calls,
             round(s.total_exec_time::numeric
                   - coalesce((p_before -> (s.userid::text || ':' || s.queryid::text) ->> 1)::numeric, 0), 1) as ms,
             left(regexp_replace(s.query, '\s+', ' ', 'g'), 300) as query
        from extensions.pg_stat_statements s
       where s.userid in ('anon'::regrole, 'authenticated'::regrole)
    ) x
    where x.calls > 0
    order by x.ms desc
    limit 8
  ) t;
  return v;
end
$function$;
comment on function public.ops_capacity_statements(jsonb) is
  'Read-only: pg_stat_statements for the public roles. p_before null → snapshot {userid:queryid: [calls, ms]}; '
  'p_before = that snapshot → the top 8 statements by time since it, with their text (the capacity check''s root cause).';
revoke all on function public.ops_capacity_statements(jsonb) from public, anon, authenticated;
grant execute on function public.ops_capacity_statements(jsonb) to service_role;

create or replace function public.mon_detect_capacity_regression()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare n int := 0; v_runs public.ops_capacity_run[]; v_last public.ops_capacity_run; v_prev public.ops_capacity_run;
  v_first int; v_floor int;
begin
  -- measured runs only (a ramp stopped by foreign load measured nothing), newest first; a run's last step row is
  -- its stop step
  select coalesce(array_agg(r::public.ops_capacity_run order by r.run_at desc), '{}') into v_runs
    from (select distinct on (run_id) * from public.ops_capacity_run
           where ended in ('limit', 'cap') and safe_concurrency is not null
           order by run_id, step desc) r;
  v_last := v_runs[1];
  v_prev := v_runs[2];
  v_first := (v_runs[array_length(v_runs, 1)]).safe_concurrency;

  if coalesce(v_last.run_at, timestamptz '2026-11-05 12:00+00') < now() - interval '8 days' then
    n := n + public.mon_raise('P1', 'search_capacity_check_silent', 'search', 'search_capacity_check_silent',
      jsonb_build_object('last_measured_run', v_last.run_at, 'workflow', '.github/workflows/capacity-check.yml',
        'why', 'No measured search capacity run for 8 days (a run stopped by foreign load measures nothing). Nobody '
            || 'would know if many people searching at once now makes the first card late. Open the workflow runs.'));
  else
    perform public.mon_resolve_stale_keys('search_capacity_check_silent', '{}');
  end if;

  if v_last.run_id is null then return n; end if;
  v_floor := greatest(2, v_first - 1);
  if v_last.safe_concurrency < v_floor then
    n := n + public.mon_raise('P1', 'search_capacity_below_floor', 'search', 'search_capacity_below_floor',
      jsonb_build_object('safe_concurrency', v_last.safe_concurrency, 'floor', v_floor, 'first_measured', v_first,
        'run_at', v_last.run_at, 'stopped_at_users', v_last.concurrency, 'data_ready_p95_ms', v_last.p95_ms,
        'verdict', v_last.verdict, 'slowest_call', v_last.slowest_call, 'top_sql', v_last.slowest_sql,
        'why', 'Fewer people can now search at the same time and still see the first card by 12 s (owner rule '
            || '2026-11-05) than the floor. Read slowest_call and top_sql in the run row: fix the slowest statement '
            || '(or the load in front of it) before users meet it; never lower the floor to clear this.'));
  else
    perform public.mon_resolve_stale_keys('search_capacity_below_floor', '{}');
  end if;

  if v_prev.run_id is not null and v_last.safe_concurrency < v_prev.safe_concurrency then
    n := n + public.mon_raise('P2', 'search_capacity_dropped', 'search', 'search_capacity_dropped',
      jsonb_build_object('safe_concurrency', v_last.safe_concurrency, 'previous', v_prev.safe_concurrency,
        'previous_run_at', v_prev.run_at, 'run_at', v_last.run_at, 'slowest_call', v_last.slowest_call,
        'why', 'The safe number of simultaneous searches dropped since the previous weekly run.'));
  else
    perform public.mon_resolve_stale_keys('search_capacity_dropped', '{}');
  end if;
  return n;
end
$function$;
revoke all on function public.mon_detect_capacity_regression() from public, anon, authenticated;
grant execute on function public.mon_detect_capacity_regression() to service_role;

-- Roster (an unrostered detector is decoration). Needle-edit of the LIVE body, read in this same step.
do $roster$
declare d text; anchor text := '''mon_detect_pin_coverage_below_floor'','; k int; fn text := 'mon_detect_capacity_regression';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''' || fn || '''' in d) > 0 then
    raise notice '% already rostered', fn;
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    execute replace(d, anchor, '''' || fn || ''', ' || anchor);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_capacity_regression''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF, both directions, inside rolled-back sub-transactions: a drop below the floor raises P1 (and P2 against the
-- previous run) while a healthy run raises neither; a last run 10 days old raises the silent P1; a fresh one does not;
-- and the two read-only functions answer.
do $proof$
declare v_open int; snap jsonb; act jsonb;
begin
  begin
    insert into public.ops_capacity_run (run_id, run_at, step, concurrency, p95_limit_ms, safe_concurrency, ended, notes) values
      (gen_random_uuid(), now() - interval '14 days', 1, 6, 11500, 6, 'limit', '{"proof":true}'),
      (gen_random_uuid(), now() - interval '7 days',  1, 6, 11500, 6, 'limit', '{"proof":true}'),
      (gen_random_uuid(), now() - interval '1 hour',  1, 4, 11500, 3, 'limit', '{"proof":true}');
    perform public.mon_detect_capacity_regression();
    select count(*) into v_open from public.alert_event where dedup_key = 'search_capacity_below_floor' and resolved_at is null;
    if v_open <> 1 then raise exception 'PROOF: safe 3 under floor 5 did not raise P1'; end if;
    select count(*) into v_open from public.alert_event where dedup_key = 'search_capacity_dropped' and resolved_at is null;
    if v_open <> 1 then raise exception 'PROOF: 6 → 3 did not raise the P2 drop'; end if;
    select count(*) into v_open from public.alert_event where dedup_key = 'search_capacity_check_silent' and resolved_at is null;
    if v_open <> 0 then raise exception 'PROOF: a run 1 hour old read as silent'; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  begin
    insert into public.ops_capacity_run (run_id, run_at, step, concurrency, p95_limit_ms, safe_concurrency, ended, notes) values
      (gen_random_uuid(), now() - interval '17 days', 1, 6, 11500, 6, 'limit', '{"proof":true}'),
      (gen_random_uuid(), now() - interval '10 days', 1, 8, 11500, 8, 'cap',   '{"proof":true}'),
      (gen_random_uuid(), now() - interval '1 hour',  0, 0, 11500, null, 'foreign_load', '{"proof":true}');
    perform public.mon_detect_capacity_regression();
    select count(*) into v_open from public.alert_event where dedup_key = 'search_capacity_check_silent' and resolved_at is null;
    if v_open <> 1 then raise exception 'PROOF: 10 days without a measured run (a foreign-load stop since) did not raise'; end if;
    select count(*) into v_open from public.alert_event where dedup_key in ('search_capacity_below_floor', 'search_capacity_dropped') and resolved_at is null;
    if v_open <> 0 then raise exception 'PROOF: a healthy 6 → 8 history raised a capacity alarm'; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  act := public.ops_capacity_db_activity();
  snap := public.ops_capacity_statements(null);
  if act ->> 'active' is null or jsonb_typeof(snap) <> 'object' or jsonb_typeof(public.ops_capacity_statements(snap)) <> 'array' then
    raise exception 'PROOF: the read-only activity / statements functions did not answer';
  end if;
  raise notice 'PROOF OK: below floor → P1 + P2, healthy → none, silent 8 days → P1, read-only functions answer, rostered';
end
$proof$;
