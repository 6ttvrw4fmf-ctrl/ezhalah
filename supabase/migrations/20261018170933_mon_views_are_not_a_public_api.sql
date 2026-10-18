-- APPLIED 2026-10-18 (owner session). SECURITY P1, second half of 20261018160725_mon_functions_are_not_a_public_api:
-- the monitoring VIEWS are not a public API either, and no view is writable with the public key.
--
-- THE HOLE: all 26 public.mon_* views were SELECT-able — and INSERT/UPDATE/DELETE-able — by anon, authenticated and
-- PUBLIC (Supabase's default table privileges), with no security_invoker, so they read AS THEIR OWNER past every RLS
-- policy. Three are auto-updatable over live data: mon_price_size_integrity_review and
-- mon_located_row_visible_only_unfiltered (search_listings_ar), mon_rent_period_source_corroboration
-- (wasalt_residential_listings) — the publishable key could PATCH/DELETE served listings through them. Six non-mon views
-- have the same write-through shape (monitoring_dashboard and ops_engineer_alert_queue → alert_event,
-- listing_source_district_ar → gathern_residential_listings, ops_aqar_recent_kills, ops_active_claims,
-- platforms_deprecated_status).
--
-- WHO READS mon_* VIEWS (grep of src/, supabase/functions/, scripts/, scrapers/, .github/ on 2026-10-18): the web app and
-- edge functions — none. check_audit_invariants.py, lifecycle_report.py and dealapp/liveness_run.py use the service key.
-- The one public-key reader, scripts/verify-district-source-truth-live.ts (a manual live run, not in npm test), now uses
-- the service key. So NO mon_* view stays on the public key. (verify-safety-barrier.ts in the no-secret npm test reads
-- the TABLE mon_safety_barrier_state through its own RLS read policy — five counters, no listing or user data; tables
-- are untouched here.)
-- WHO WRITES THROUGH ANY VIEW with anon/authenticated: nobody — the app writes only the tables clicks, listings and
-- user_chats; no view has an INSTEAD OF trigger.
--
-- THE FIX:
--   · every public.mon_* view / materialized view: REVOKE ALL from PUBLIC, anon, authenticated; service_role keeps SELECT.
--     That also ends the two views that started erroring for anon after the function revoke (mon_searchability_alerts,
--     mon_unverified_inactivations_24h) — access removed, functions NOT re-granted.
--   · every public view (any name): REVOKE INSERT, UPDATE, DELETE, TRUNCATE from PUBLIC, anon, authenticated. Reads are
--     untouched.
--   · event trigger mon_views_born_revoked on CREATE VIEW / CREATE MATERIALIZED VIEW does both for every new view.
create or replace function public.mon_views_born_revoked() returns event_trigger
language plpgsql as $$
declare r record;
begin
  for r in select c.objid, k.relname, k.relkind from pg_event_trigger_ddl_commands() c
            join pg_class k on k.oid = c.objid
           where c.classid = 'pg_class'::regclass and k.relnamespace = 'public'::regnamespace and k.relkind in ('v', 'm') loop
    if r.relname like 'mon\_%' then
      execute format('revoke all on table public.%I from public, anon, authenticated', r.relname);
      execute format('grant select on table public.%I to service_role', r.relname);
    elsif r.relkind = 'v' then
      execute format('revoke insert, update, delete, truncate on table public.%I from public, anon, authenticated', r.relname);
    end if;
  end loop;
end $$;
drop event trigger if exists mon_views_born_revoked;
create event trigger mon_views_born_revoked on ddl_command_end
  when tag in ('CREATE VIEW', 'CREATE MATERIALIZED VIEW')
  execute function public.mon_views_born_revoked();

do $revoke$
declare r record;
begin
  for r in select c.relname, c.relkind from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm') loop
    if r.relname like 'mon\_%' then
      execute format('revoke all on table public.%I from public, anon, authenticated', r.relname);
      execute format('grant select on table public.%I to service_role', r.relname);
    elsif r.relkind = 'v' then
      execute format('revoke insert, update, delete, truncate on table public.%I from public, anon, authenticated', r.relname);
    end if;
  end loop;
end
$revoke$;

-- APPLY-TIME PROOF
do $proof$
declare leaked text; writable text; svc_missing text; probe_open boolean;
begin
  select string_agg(c.relname, ', ') into leaked from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm') and c.relname like 'mon\_%'
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT')
          or exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0));
  if leaked is not null then raise exception 'PROOF: mon_* views still readable by anon/authenticated/PUBLIC: %', leaked; end if;
  select string_agg(c.relname, ', ') into writable from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
     and (has_table_privilege('anon', c.oid, 'INSERT') or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE')
          or has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
          or has_table_privilege('authenticated', c.oid, 'DELETE'));
  if writable is not null then raise exception 'PROOF: views still writable with the public key: %', writable; end if;
  select string_agg(c.relname, ', ') into svc_missing from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm') and c.relname like 'mon\_%'
     and not has_table_privilege('service_role', c.oid, 'SELECT');
  if svc_missing is not null then raise exception 'PROOF: service_role lost SELECT on %', svc_missing; end if;
  -- a NEW mon_* view is born revoked, a new ordinary view is born read-only for the public key (rolled back)
  begin
    execute 'create view public.mon_zz_born_revoked_probe as select 1 as x';
    execute 'create view public.zz_born_read_only_probe as select 1 as x';
    probe_open := has_table_privilege('anon', 'public.mon_zz_born_revoked_probe', 'SELECT')
               or has_table_privilege('authenticated', 'public.mon_zz_born_revoked_probe', 'SELECT')
               or not has_table_privilege('service_role', 'public.mon_zz_born_revoked_probe', 'SELECT')
               or has_table_privilege('anon', 'public.zz_born_read_only_probe', 'UPDATE')
               or has_table_privilege('authenticated', 'public.zz_born_read_only_probe', 'DELETE');
    if probe_open then raise exception 'PROOF: a new view was born with the old public grants'; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  raise notice 'PROOF OK: 0 mon_* views readable and 0 views writable with the public key; new views are born that way';
end
$proof$;
