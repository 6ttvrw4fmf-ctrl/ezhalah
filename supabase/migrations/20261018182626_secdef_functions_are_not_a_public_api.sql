-- APPLIED 2026-10-18 (owner session). SECURITY P1: a SECURITY DEFINER function is not a public API unless an explicit,
-- reasoned allowlist says so.
--
-- THE HOLE (coordinator, 10-18): 45 SECURITY DEFINER + VOLATILE functions in public were EXECUTE-able by anon (and
-- authenticated, and PUBLIC — Supabase's default function privileges). They run as their owner, so the publishable key in
-- the web bundle could: reset the $0.50/h AI spend breaker (ai_spend_reset — an unlimited-cost attack; the owner resets
-- it, never us), open or block deploys (acquire_deploy_lock / release_deploy_lock / ops_selftest_deploy_lock_exclusive),
-- flip listing lifecycle (inactive_now, auto_recover_false_inactive, reactivate_recovered_dormant_platforms), claim work
-- areas, promote alerts to incidents, and run the sync_* / resolve_* / remediate_* writers.
--
-- WHO CALLS THEM (grep of src/, api/, supabase/functions/, e2e/, scripts/, scrapers/, .github/, docs on 2026-10-18):
--   · the web app: ONLY log_zero_result (src/data/zeroResultLog.ts);
--   · the agent edge calls ai_spend_gate with the SERVICE key (supabase/functions/agent/index.ts SERVICE_KEY);
--   · deploy-lock.sh, agent-surface.sh, deploy-lock-concurrency-proof.yml, gathern/liveness.py, the content-parity check:
--     the SERVICE key; pg_cron runs as postgres; routines call claim_work_area / ops_record_sentry_heartbeat through SQL;
--   · the e2e harness calls ops_qa_record_coverage / ops_qa_record_scope with the PUBLIC key by design (browser-driving
--     jobs never hold the service role — verify-live-sweep-coverage-contract.ts);
--   · tg_archive_hard_deleted_listing is a trigger function: a trigger fires without EXECUTE.
-- SURVIVORS (3 of 45), each validated and rate-capped below: log_zero_result (anon + authenticated),
-- ops_qa_record_coverage (anon), ops_qa_record_scope (anon). Every other one: REVOKE from PUBLIC, anon, authenticated;
-- service_role and postgres keep EXECUTE. Also revoked: rate_served_as_total_rows / served_total_below_city_floor_rows
-- (STABLE, mine, no public caller, a full scan of the served index each).
--
-- THE GUARD: public.ops_public_secdef_allowlist (name, roles, reason ≥ 20 chars) is the ONLY way a SECURITY DEFINER
-- function in public is callable with the public key. It holds the 3 survivors, the 4 read-only mon_* checks
-- (20261018160725) and the 48 STABLE definer functions that were already public (each with its caller, or «no caller found
-- … on the review list») so a CREATE OR REPLACE cannot silently change any of them. Event trigger ops_secdef_born_revoked
-- (CREATE FUNCTION / CREATE PROCEDURE / ALTER FUNCTION) gives every SECURITY DEFINER function exactly its allowlisted
-- roles, and none if it is not listed.
create table if not exists public.ops_public_secdef_allowlist (
  proname  text primary key,
  grant_to text[] not null check (cardinality(grant_to) > 0 and grant_to <@ array['anon', 'authenticated']::text[]),
  reason   text not null check (length(btrim(reason)) >= 20),
  added_on date not null default current_date
);
alter table public.ops_public_secdef_allowlist enable row level security;
revoke all on table public.ops_public_secdef_allowlist from public, anon, authenticated;

insert into public.ops_public_secdef_allowlist (proname, grant_to, reason) values
  ('log_zero_result', '{anon,authenticated}', 'web app: src/data/zeroResultLog.ts logs every visitor''s zero-result search (logged in or not). Writes one validated jsonb object (<= 4,000 chars) into ops_zero_result_log; 3,000/h flood guard.'),
  ('ops_qa_record_coverage', '{anon}', 'e2e harness (e2e/journeys/harness.mjs, e2e/live-sweep, e2e/qa-coverage) records QA coverage with the PUBLIC key by design: browser-driving jobs never hold the service role. Validated (dimension <= 80, key <= 200, pass|fail|skip, notes <= 500) + 10,000 keys/h cap.'),
  ('ops_qa_record_scope', '{anon}', 'e2e/qa-coverage/harvest-scope.mjs records the client table-scope registry with the PUBLIC key by design. Validated (scope <= 16 chars, 1-1,000 entries, each an existing public table) + 30 scopes/h cap.'),
  ('mon_orphaned_detectors', '{anon}', 'read-only STABLE check called with the public key by scripts/verify-orphaned-detector-meta-check.ts inside the required no-secret npm test (20261018160725).'),
  ('mon_oracle_never_retires', '{anon}', 'read-only STABLE check called with the public key by scripts/verify-oracle-never-retires-live.ts (oracle-retirement-check.yml, no secrets) (20261018160725).'),
  ('mon_oracle_retirement_facts', '{anon}', 'read-only STABLE check called with the public key by scripts/verify-oracle-never-retires-live.ts (oracle-retirement-check.yml, no secrets) (20261018160725).'),
  ('mon_detectors_outside_raise_candidate_set', '{anon}', 'read-only STABLE check called with the public key by scripts/verify-detector-candidate-set-is-not-blind-live.ts (20261018160725).'),
  ('af_extra_attrs_uncovered_tables', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('af_rebuild_would_revert', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('ai_budget_status', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('ai_cost_dashboard', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('district_blank_is_excused', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('district_blank_unexplained', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('facade_lost_to_vocabulary', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('get_shared_chat', '{authenticated}', 'web app reads it: src/lib/shareSearch.ts, src/lib/sharedChat.ts. STABLE, writes nothing.'),
  ('incident_queue', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('incident_resolve_routine_slug', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('loader_active_platforms_ar', '{anon,authenticated}', 'web app reads it: src/components/SearchLoader.tsx, src/lib/filterWelcome.ts. STABLE, writes nothing.'),
  ('loader_platform_status_ar', '{anon,authenticated}', 'web app reads it: src/data/loaderPlatforms.ts, src/data/loaderActivePlatforms.ts. STABLE, writes nothing.'),
  ('loader_scale_stats_ar', '{anon,authenticated}', 'web app reads it: src/components/SearchLoader.tsx, src/lib/filterWelcome.ts. STABLE, writes nothing.'),
  ('loader_strip_platforms_ar', '{anon,authenticated}', 'web app reads it: src/data/pickerLivePlatforms.ts. STABLE, writes nothing.'),
  ('ops_af_attribute_coverage', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-af-attribute-views-cover-every-platform-live.ts.'),
  ('ops_af_clause_surfaces', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-clause-carrying-rpcs-are-templated.ts.'),
  ('ops_cron_start_instants', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('ops_deploy_lock_status', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/safe-deploy.sh.'),
  ('ops_deploy_preflight_checks', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-migration-drift-vs-production.ts, scripts/schema-drift-gate.sh.'),
  ('ops_image_coverage_latest', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-image-coverage-ratchet-live.ts, scripts/verify-active-platform-image-coverage-not-blind.ts.'),
  ('ops_lifecycle_backlog_evidence_class', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-deletion-stall-names-its-evidence-class.ts.'),
  ('ops_lifecycle_dead_copy_is_a_contradiction', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-lifecycle-duplicate-detector-self-tests-its-predicate.ts.'),
  ('ops_lifecycle_deletion_audit_unconfirmed', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-deletion-audit-blindness-is-visible.ts.'),
  ('ops_lifecycle_deletion_backlog', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('ops_lifecycle_duplicate_stale_copy', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-lifecycle-duplicate-detector-self-tests-its-predicate.ts.'),
  ('ops_lifecycle_false_resurrection', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-sold-pin-evidence-law.ts.'),
  ('ops_lifecycle_inactive_still_searchable', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-inactive-listing-is-not-searchable.ts.'),
  ('ops_lifecycle_ledger_rows_not_deleted', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-deletion-ledger-is-not-proof-of-a-delete.ts, scrapers/common/lifecycle_report.py.'),
  ('ops_lifecycle_propagation_cutoff', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-inactive-listing-is-not-searchable.ts.'),
  ('ops_liveness_checking_shortfall', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('ops_location_index_coverage', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-location-index-covers-every-searchable-platform-live.ts.'),
  ('ops_migration_content_digests', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-migration-content-parity.ts, scripts/verify-migration-content-parity-wired.ts.'),
  ('ops_migration_sql', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('ops_p0_detectors_off_fast_lane', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-p0-fast-lane-detection.ts.'),
  ('ops_p0_lane_contract', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-p0-sweep-exposure-evidence.ts.'),
  ('ops_qa_cohort_catalog', '{anon,authenticated}', 'read-only STABLE check called with the public key by e2e/qa-coverage/run.mjs, e2e/qa-coverage/narrowing.mjs.'),
  ('ops_qa_scope_current', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('ops_qa_sweep_plan', '{anon,authenticated}', 'read-only STABLE check called with the public key by e2e/live-sweep/sweep.mjs, e2e/qa-coverage/run.mjs.'),
  ('ops_search_load_now', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/lib/afJourneyPacing.ts.'),
  ('ops_searchable_platforms_unmonitored', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-searchable-platforms-are-monitored.ts.'),
  ('scrape_run_dangling_after', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-dangling-run-threshold-is-per-platform.ts.'),
  ('search_cities_ar', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('shared_chat_card', '{anon,authenticated}', 'web app reads it: src/lib/shareSearch.ts, src/lib/sharedChat.ts. STABLE, writes nothing.'),
  ('source_district_dropped_rows', '{anon,authenticated}', 'read-only STABLE check called with the public key by scripts/verify-source-district-never-dropped.ts.'),
  ('ui_filter_greetings_ar', '{anon,authenticated}', 'web app reads it: src/data/loaderFilterGreetings.ts. STABLE, writes nothing.'),
  ('ui_results_found_ar', '{anon,authenticated}', 'web app reads it: src/data/resultsFoundRotation.ts, src/data/loaderResultsFound.ts. STABLE, writes nothing.'),
  ('unknown_named_districts', '{anon,authenticated}', 'read-only STABLE; no caller found in the repo on 2026-10-18. Kept exactly as it was so a CREATE OR REPLACE cannot silently change it; on the review list.'),
  ('welcome_new_today_ar', '{anon,authenticated}', 'web app reads it: src/lib/filterWelcome.ts, src/data/welcomeFacts.ts. STABLE, writes nothing.')

on conflict (proname) do update set grant_to = excluded.grant_to, reason = excluded.reason;

-- SURVIVOR HARDENING (validation + rate caps; anchored in-place patches, each anchor must be found exactly once)
do $harden$
declare d text; a text; b text;
begin
  select pg_get_functiondef('public.ops_qa_record_coverage(text,text,text,text)'::regprocedure) into d;
  a := $a$raise exception 'ops_qa_record_coverage: result must be pass | fail | skip';
  end if;$a$;
  b := $b$raise exception 'ops_qa_record_coverage: result must be pass | fail | skip';
  end if;
  -- Rate cap (2026-10-18): the public key can call this; the busiest real hour touched 2,197 keys.
  if (select count(*) from public.ops_qa_coverage_ledger where last_tested_at > now() - interval '1 hour') >= 10000 then
    raise exception 'ops_qa_record_coverage: hourly cap of 10,000 keys reached';
  end if;$b$;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'coverage anchor not found exactly once'; end if;
  execute replace(d, a, b);

  select pg_get_functiondef('public.ops_qa_record_scope(text,text[],text)'::regprocedure) into d;
  a := $a$an empty registry reads as "everything is reachable"', p_scope;
  end if;$a$;
  b := $b$an empty registry reads as "everything is reachable"', p_scope;
  end if;
  -- Validation + rate cap (2026-10-18): the public key can call this, so it may only record a short scope name and a list
  -- of tables that EXIST — never a made-up registry that would make the unreachable-inventory detector lie.
  if length(btrim(p_scope)) > 16 or cardinality(p_tables) > 1000 or length(coalesce(p_note, '')) > 300 then
    raise exception 'ops_qa_record_scope: scope/tables/note too long';
  end if;
  if exists (select 1 from unnest(p_tables) t where t is null or t !~ '^[a-z0-9_]+$' or to_regclass('public.' || t) is null) then
    raise exception 'ops_qa_record_scope: every entry must be an existing public table';
  end if;
  if (select count(*) from public.ops_qa_scope where harvested_at > now() - interval '1 hour') >= 30 then
    raise exception 'ops_qa_record_scope: hourly cap of 30 scopes reached';
  end if;$b$;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'scope anchor not found exactly once'; end if;
  execute replace(d, a, b);
end
$harden$;

-- THE GUARD for every future SECURITY DEFINER function
create or replace function public.ops_secdef_born_revoked() returns event_trigger
language plpgsql as $$
declare r record; g text;
begin
  for r in select c.objid, p.proname from pg_event_trigger_ddl_commands() c
            join pg_proc p on p.oid = c.objid
           where c.classid = 'pg_proc'::regclass and p.pronamespace = 'public'::regnamespace and p.prosecdef loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.objid::regprocedure);
    execute format('grant execute on function %s to service_role', r.objid::regprocedure);
    for g in select unnest(a.grant_to) from public.ops_public_secdef_allowlist a where a.proname = r.proname loop
      execute format('grant execute on function %s to %I', r.objid::regprocedure, g);
    end loop;
  end loop;
end $$;
drop event trigger if exists ops_secdef_born_revoked;
create event trigger ops_secdef_born_revoked on ddl_command_end
  when tag in ('CREATE FUNCTION', 'CREATE PROCEDURE', 'ALTER FUNCTION')
  execute function public.ops_secdef_born_revoked();

-- EXISTING SECURITY DEFINER functions: exactly their allowlisted roles, nothing else
do $revoke$
declare f record; g text;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.prosecdef loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role, postgres', f.sig);
    for g in select unnest(a.grant_to) from public.ops_public_secdef_allowlist a where a.proname = f.proname loop
      execute format('grant execute on function %s to %I', f.sig, g);
    end loop;
  end loop;
end
$revoke$;

-- APPLY-TIME PROOF
do $proof$
declare leaked text; missing text; probe boolean;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into leaked from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and ((has_function_privilege('anon', p.oid, 'EXECUTE') and not exists (select 1 from public.ops_public_secdef_allowlist a where a.proname = p.proname and 'anon' = any(a.grant_to)))
       or (has_function_privilege('authenticated', p.oid, 'EXECUTE') and not exists (select 1 from public.ops_public_secdef_allowlist a where a.proname = p.proname and 'authenticated' = any(a.grant_to)))
       or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0));
  if leaked is not null then raise exception 'PROOF: SECURITY DEFINER callable with the public key outside the allowlist: %', leaked; end if;
  if has_function_privilege('anon', 'public.ai_spend_reset(text,text,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.acquire_deploy_lock(text,text,integer,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ai_spend_reset(text,text,boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.ai_spend_gate(text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.acquire_deploy_lock(text,text,integer,text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.log_zero_result(jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.log_zero_result(jsonb)', 'EXECUTE') then
    raise exception 'PROOF: a named function has the wrong grants';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into missing from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and not has_function_privilege('service_role', p.oid, 'EXECUTE');
  if missing is not null then raise exception 'PROOF: service_role lost EXECUTE on %', missing; end if;
  -- the guard: a new definer function is born revoked; an allowlisted name gets exactly its roles (rolled back)
  begin
    execute 'create function public.zz_secdef_probe() returns int language sql security definer as $f$ select 1 $f$';
    insert into public.ops_public_secdef_allowlist values ('zz_secdef_allowed_probe', '{anon}', 'probe row, rolled back at apply time');
    execute 'create function public.zz_secdef_allowed_probe() returns int language sql security definer as $f$ select 1 $f$';
    execute 'create function public.zz_secdef_later_probe() returns int language sql as $f$ select 1 $f$';
    execute 'alter function public.zz_secdef_later_probe() security definer';
    probe := has_function_privilege('anon', 'public.zz_secdef_probe()', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.zz_secdef_probe()', 'EXECUTE')
          or not has_function_privilege('service_role', 'public.zz_secdef_probe()', 'EXECUTE')
          or not has_function_privilege('anon', 'public.zz_secdef_allowed_probe()', 'EXECUTE')
          or has_function_privilege('authenticated', 'public.zz_secdef_allowed_probe()', 'EXECUTE')
          or has_function_privilege('anon', 'public.zz_secdef_later_probe()', 'EXECUTE');
    if probe then raise exception 'PROOF: the born-revoked guard did not hold for a new definer function'; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  -- the survivors refuse what they should
  begin
    perform public.ops_qa_record_scope('zz', array['not_a_table_xyz'], null);
    raise exception 'PROOF: ops_qa_record_scope accepted a table that does not exist';
  exception when others then
    if sqlerrm !~ 'existing public table' then raise; end if;
  end;
  raise notice 'PROOF OK: SECURITY DEFINER functions are callable with the public key only as the allowlist says';
end
$proof$;
