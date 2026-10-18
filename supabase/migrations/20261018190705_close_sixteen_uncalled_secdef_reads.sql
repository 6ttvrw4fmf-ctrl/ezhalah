-- APPLIED 2026-10-18 (owner session, coordinator decision). SECURITY follow-up of 20261018182626: the 16 read-only
-- SECURITY DEFINER functions kept public with «no caller found in the repo» are closed to the public key.
--
-- Re-checked before revoking (grep of the whole repo outside migrations/ on 2026-10-18): no web-app, edge, e2e or
-- public-key script caller for any of them — the script mentions (verify-af-rpcs-not-hand-edited, verify-ai-spend-safety,
-- verify-source-district-never-dropped, verify-incident-spine) only parse SQL; engineers read ops_migration_sql(<version>)
-- through SQL as postgres. No anon-readable view or policy calls them; the one SECURITY INVOKER caller
-- (rebuild_af_filter_rpcs → af_rebuild_would_revert) is DDL that anon could never run anyway.
-- Most exposing first: ops_migration_sql (full migration SQL), ai_cost_dashboard, ai_budget_status, incident_queue.
-- REVERSIBLE: one ops_public_secdef_allowlist row with a reason, then GRANT (or any CREATE OR REPLACE), brings one back.
do $close$
declare n text; f regprocedure; removed int;
  names constant text[] := array['ops_migration_sql', 'ai_cost_dashboard', 'ai_budget_status', 'incident_queue',
    'af_extra_attrs_uncovered_tables', 'af_rebuild_would_revert', 'district_blank_is_excused', 'district_blank_unexplained',
    'facade_lost_to_vocabulary', 'incident_resolve_routine_slug', 'ops_cron_start_instants', 'ops_lifecycle_deletion_backlog',
    'ops_liveness_checking_shortfall', 'ops_qa_scope_current', 'search_cities_ar', 'unknown_named_districts'];
begin
  delete from public.ops_public_secdef_allowlist where proname = any(names) and reason like 'read-only STABLE; no caller found%';
  get diagnostics removed = row_count;
  if removed <> 16 then raise exception 'expected to remove 16 «no caller» allowlist rows, removed %', removed; end if;
  foreach n in array names loop
    for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = n loop
      execute format('revoke execute on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role, postgres', f);
    end loop;
  end loop;
end
$close$;

-- APPLY-TIME PROOF
do $proof$
declare leaked text; left_open text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into left_open from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('ops_migration_sql', 'ai_cost_dashboard', 'ai_budget_status', 'incident_queue',
     'af_extra_attrs_uncovered_tables', 'af_rebuild_would_revert', 'district_blank_is_excused', 'district_blank_unexplained',
     'facade_lost_to_vocabulary', 'incident_resolve_routine_slug', 'ops_cron_start_instants', 'ops_lifecycle_deletion_backlog',
     'ops_liveness_checking_shortfall', 'ops_qa_scope_current', 'search_cities_ar', 'unknown_named_districts')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
          or not has_function_privilege('service_role', p.oid, 'EXECUTE'));
  if left_open is not null then raise exception 'PROOF: still public (or lost service_role): %', left_open; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into leaked from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and ((has_function_privilege('anon', p.oid, 'EXECUTE') and not exists (select 1 from public.ops_public_secdef_allowlist a where a.proname = p.proname and 'anon' = any(a.grant_to)))
       or (has_function_privilege('authenticated', p.oid, 'EXECUTE') and not exists (select 1 from public.ops_public_secdef_allowlist a where a.proname = p.proname and 'authenticated' = any(a.grant_to))));
  if leaked is not null then raise exception 'PROOF: SECURITY DEFINER callable with the public key outside the allowlist: %', leaked; end if;
  if (select count(*) from public.ops_public_secdef_allowlist) <> 39
     or exists (select 1 from public.ops_public_secdef_allowlist where reason like 'read-only STABLE; no caller found%') then
    raise exception 'PROOF: the allowlist is not the expected 39 reasoned rows';
  end if;
  raise notice 'PROOF OK: the 16 are closed to the public key; the allowlist holds 39 rows, every one with a caller';
end
$proof$;
