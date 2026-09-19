-- A SQL-language function body is NOT dependency-checked against the signatures it calls. Drop or
-- re-sign a callee and every caller keeps its catalog entry, stays "present", and fails only when
-- something actually calls it — during SQL-function STARTUP, so every call fails regardless of
-- arguments.
--
-- That is exactly how ops_qa_search_differential_ui() died: 20260821025711 dropped the stale
-- p_scope-leading overload of ops_qa_search_differential() to clear the PGRST203 duplicate-overload
-- hazard, reasoning "this QA/diagnostic function has no app or scripts caller" — true of the repo,
-- but ops_qa_search_differential_ui() is a DATABASE caller. It was dead for 24 days (2026-08-21 →
-- 2026-09-14) and nothing in the tree could have noticed: the object exists, the grants exist, and
-- no barrier ever CALLED it. (ops_incident #254, routed to routine-4 by routine-3 on 2026-09-14.)
--
-- This detector closes the CLASS, not the instance: it EXECUTES every read-only public.ops_qa_*
-- function once a day and reports any whose body no longer resolves. Existence is not the assertion
-- — execution is. Writers are excluded BY DECLARATION (provolatile 'v'), never by a hand-kept skip
-- list that could rot, and a function added tomorrow is probed without anyone registering it.
create or replace function public.mon_detect_dead_qa_oracle_wrapper()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  n       int := 0;
  r       record;
  live    text[] := '{}';
  v_ui    text;
  v_scope text;
  v_names text[];
  v_types text[];
  v_nreq  int;
  v_args  text;
  v_val   text;
  v_sql   text;
  i       int;
begin
  -- Daily cadence: the probe drives real predicate scans over search_listings_ar, and the class it
  -- watches changes on migrations, not minute to minute (20260810201833's gate, same reasoning).
  if not public.mon_claim_daily_slot('dead_qa_oracle_wrapper') then return 0; end if;

  select c.ui_type into v_ui    from public.ops_qa_cohort c order by c.ui_type limit 1;
  select s.scope   into v_scope from public.ops_qa_scope  s order by s.scope   limit 1;

  -- An empty registry means the oracle cannot be probed at all. Say that, loudly — never let
  -- "nothing to test" read as "everything passed" (AGENTS.md: a failed fetch is not an empty answer).
  if v_ui is null or v_scope is null then
    live := live || 'dead_qa_oracle_wrapper:__registry_empty__';
    n := n + public.mon_raise('P2', 'dead_qa_oracle_wrapper', 'monitoring',
      'dead_qa_oracle_wrapper:__registry_empty__',
      jsonb_build_object(
        'cohorts', (select count(*) from public.ops_qa_cohort),
        'scopes',  (select count(*) from public.ops_qa_scope),
        'why', 'ops_qa_cohort or ops_qa_scope is empty, so no ops_qa_* wrapper could be probed '
            || 'this run. The oracle layer is UNMEASURED, not clean.',
        'action', 'run e2e/qa-coverage/harvest-scope.mjs against production to refill the registry'));
    perform public.mon_resolve_stale_keys('dead_qa_oracle_wrapper', live);
    return n;
  end if;

  for r in
    select p.oid, p.proname, p.oid::regprocedure::text as sig,
           p.proargnames, p.pronargs, p.pronargdefaults, p.proargtypes
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname like 'ops\_qa\_%'
       and p.prokind = 'f'
       -- READ-ONLY BY DECLARATION. ops_qa_ledger_record / ops_qa_load_run / ops_qa_adjudicate /
       -- ops_qa_record_coverage / ops_qa_record_scope are VOLATILE writers and are excluded here by
       -- what they ARE, so this probe can never write QA state as a side effect of monitoring it.
       and p.provolatile in ('i','s')
     order by p.proname
  loop
    -- Supply ONLY the required arguments, positionally; every DEFAULT fills itself in. Values come
    -- from the live registry by PARAMETER NAME where we know it, NULL of the declared type
    -- otherwise — enough to reach body startup, which is where this class of breakage raises.
    v_names := r.proargnames;
    v_types := string_to_array(oidvectortypes(r.proargtypes), ', ');
    v_nreq  := r.pronargs - r.pronargdefaults;
    v_args  := '';
    i := 1;
    while i <= v_nreq loop
      v_val := case coalesce(v_names[i], '')
                 when 'p_ui_type' then quote_literal(v_ui)
                 when 'p_scope'   then quote_literal(v_scope)
                 when 'p_tables'  then format('public.ops_qa_scope_tables(%L)', v_scope)
                 when 'p_types'   then format('public.ops_qa_cohort_types(%L)', v_ui)
                 else format('null::%s', v_types[i])
               end;
      v_args := v_args || case when i > 1 then ', ' else '' end || v_val;
      i := i + 1;
    end loop;

    v_sql := format('select 1 from public.%I(%s) limit 1', r.proname, v_args);
    begin
      execute v_sql;
    exception when others then
      live := live || ('dead_qa_oracle_wrapper:' || r.proname);
      n := n + public.mon_raise('P2', 'dead_qa_oracle_wrapper', 'monitoring',
        'dead_qa_oracle_wrapper:' || r.proname,
        jsonb_build_object(
          'function', r.sig,
          'sqlstate', sqlstate,
          'error', sqlerrm,
          'probe', v_sql,
          'why', 'This read-only QA oracle function EXISTS but cannot run. A SQL-language body is '
              || 'not dependency-checked against its callees, so a dropped or re-signed callee '
              || 'leaves the caller present and broken until something calls it. Existence is not '
              || 'health.',
          'adjudicate', 'A 42883 "does not exist ... during startup" means a callee signature moved '
              || 'under it — repair the wrapper against the CURRENT signature. Do NOT silence this '
              || 'by dropping the wrapper unless it is genuinely superseded, and never repair it by '
              || 'guessing a scope-token -> table mapping: ops_qa_scope / ops_qa_scope_tables hold '
              || 'the harvested truth, and a guessed mapping turns a loudly-dead oracle into a '
              || 'confidently-wrong one, which is strictly worse.'));
    end;
  end loop;

  -- Self-heal per function: a wrapper that runs again clears its own key.
  perform public.mon_resolve_stale_keys('dead_qa_oracle_wrapper', live);
  return n;
end $function$;

comment on function public.mon_detect_dead_qa_oracle_wrapper() is
  'ops_incident #254 (2026-09-15, routine-4): EXECUTES every read-only public.ops_qa_* function daily '
  'so a wrapper whose body no longer resolves is RED rather than merely unused. Writers are excluded '
  'by provolatile, so the probe cannot write QA state.';

-- ROSTER ENTRY, in the SAME migration (AGENTS.md: a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors() fires on it). Appended by rewriting the roster's own definition
-- rather than retyping ~200 lines of it; idempotent, and it FAILS LOUD if the anchor ever moves.
do $roster$
declare d text;
begin
  d := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_dead_qa_oracle_wrapper' in d) > 0 then
    return;                                   -- already rostered
  end if;
  if position($anchor$'mon_detect_rakez_off_plan_resurrection'$anchor$ in d) = 0 then
    raise exception 'mon_run_all_detectors roster anchor not found — add '
                    'mon_detect_dead_qa_oracle_wrapper to the roster explicitly';
  end if;
  d := replace(d,
        $anchor$'mon_detect_rakez_off_plan_resurrection'$anchor$,
        $anchor$'mon_detect_rakez_off_plan_resurrection',
    'mon_detect_dead_qa_oracle_wrapper'$anchor$);
  execute d;
end $roster$;
