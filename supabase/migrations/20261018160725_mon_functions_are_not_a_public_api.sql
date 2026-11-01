-- APPLIED 2026-10-18 (owner session). SECURITY P1: the monitoring layer is not a public API.
--
-- THE HOLE: 346 of the 378 public.mon_* functions were EXECUTE-able by `anon` (and `authenticated`, and PUBLIC) — the
-- publishable key ships in the web bundle, so anyone could POST /rest/v1/rpc/mon_raise to spam alert_event, or loop
-- mon_run_all_detectors / mon_detect_card_label_contract (15+ min under load earlier today) to load the database.
-- Supabase's default privileges grant EXECUTE on every new public function to anon + authenticated.
--
-- WHO CALLS mon_* (grep of src/, app/, supabase/functions/, scripts/, scrapers/, .github/ on 2026-10-18): the web app and
-- edge functions — NONE. pg_cron (all 32 jobs that touch mon_*) runs as postgres; scrapers and workflows that raise or
-- resolve alerts use the service-role key. Exactly four callers use the PUBLIC key, and all four are read-only checks:
--   · mon_orphaned_detectors(text[])                   — scripts/verify-orphaned-detector-meta-check.ts, inside the REQUIRED
--                                                         `npm test`, which runs with no secrets by design;
--   · mon_oracle_never_retires(integer),
--     mon_oracle_retirement_facts()                     — scripts/verify-oracle-never-retires-live.ts (oracle-retirement-check.yml,
--                                                         a PR check that runs with no secrets);
--   · mon_detectors_outside_raise_candidate_set(jsonb) — scripts/verify-detector-candidate-set-is-not-blind-live.ts.
-- All four are SECURITY DEFINER, STABLE, write nothing, and answer in ≤ 150 ms together. They stay EXECUTE-able by anon
-- ONLY (not authenticated, not PUBLIC). Everything else: REVOKE from PUBLIC, anon, authenticated; service_role and
-- postgres keep EXECUTE (granted explicitly, so nothing that relied on PUBLIC loses it).
--
-- NEW FUNCTIONS: default privileges cannot filter by name, so an event trigger on CREATE FUNCTION revokes the same three
-- grantees from any public.mon_* function the moment it is created (CREATE OR REPLACE included; the four above excepted).
create or replace function public.mon_anon_readable() returns regprocedure[]
language sql immutable as $$
  select array['public.mon_orphaned_detectors(text[])',
               'public.mon_oracle_never_retires(integer)',
               'public.mon_oracle_retirement_facts()',
               'public.mon_detectors_outside_raise_candidate_set(jsonb)']::regprocedure[]
$$;

create or replace function public.mon_functions_born_revoked() returns event_trigger
language plpgsql as $$
declare r record;
begin
  for r in select c.objid from pg_event_trigger_ddl_commands() c
            join pg_proc p on p.oid = c.objid
           where c.classid = 'pg_proc'::regclass and p.pronamespace = 'public'::regnamespace and p.proname like 'mon\_%'
             and not (c.objid::regprocedure = any (public.mon_anon_readable())) loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.objid::regprocedure);
    execute format('grant execute on function %s to service_role', r.objid::regprocedure);
  end loop;
end $$;
drop event trigger if exists mon_functions_born_revoked;
create event trigger mon_functions_born_revoked on ddl_command_end
  when tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')
  execute function public.mon_functions_born_revoked();

-- existing functions (the two above included)
do $revoke$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like 'mon\_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role, postgres', f);
  end loop;
  foreach f in array public.mon_anon_readable() loop
    execute format('grant execute on function %s to anon', f);
  end loop;
end
$revoke$;

-- APPLY-TIME PROOF
do $proof$
declare leaked text; svc_missing bigint; probe_open boolean;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into leaked
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'mon\_%'
     and not (p.oid::regprocedure = any (public.mon_anon_readable()))
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if leaked is not null then raise exception 'PROOF: still callable by anon/authenticated/PUBLIC: %', leaked; end if;
  if exists (select 1 from unnest(public.mon_anon_readable()) f
              where has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE')) then
    raise exception 'PROOF: the read-only allowlist lost anon';
  end if;
  select count(*) into svc_missing from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'mon\_%'
     and not (has_function_privilege('service_role', p.oid, 'EXECUTE') and has_function_privilege('postgres', p.oid, 'EXECUTE'));
  if svc_missing <> 0 then raise exception 'PROOF: % mon_* functions lost service_role/postgres (job 38 runs as postgres)', svc_missing; end if;
  -- a NEW mon_* function is born revoked (rolled back)
  begin
    execute 'create function public.mon_zz_born_revoked_probe() returns int language sql as $f$ select 1 $f$';
    probe_open := has_function_privilege('anon', 'public.mon_zz_born_revoked_probe()', 'EXECUTE')
               or has_function_privilege('authenticated', 'public.mon_zz_born_revoked_probe()', 'EXECUTE');
    if probe_open or not has_function_privilege('service_role', 'public.mon_zz_born_revoked_probe()', 'EXECUTE') then
      raise exception 'PROOF: a new mon_* function was born callable by anon/authenticated (or without service_role)';
    end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  raise notice 'PROOF OK: 0 mon_* callable by anon/authenticated/PUBLIC outside the 4 read-only checks; service_role + postgres keep all; new ones are born revoked';
end
$proof$;
