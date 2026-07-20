-- Recovered verbatim from production on 2026-07-20 (drift reconciliation): applied directly to prod via MCP as supabase_migrations.schema_migrations version 20260717194809, name '20260717194600_mon_rls_reachability_detector'; this committed file is the source-of-truth record, NOT the apply path. Body is byte-for-byte the live statement (md5 183003a66d58c4ca7c473372cde57876).
-- Wave 1: permanent regression guard for the aqarmonthly class —
-- "a listing table has RLS enabled but no public/anon SELECT policy, so anonymous users
--  receive 0 rows while the search index still counts them (phantom cards + inflated totals)."
-- This detector makes that class immediately detectable for EVERY listing table, forever.

-- Helper: the set of listing tables currently unreachable by anon/public (RLS on, no SELECT policy).
create or replace function public.mon_rls_unreachable_tables()
returns table(tbl text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.relname::text
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public'
    and c.relkind = 'r'
    and c.relname ~ '_(residential|commercial)_listings$'
    and c.relname not like '%backup%'
    and c.relrowsecurity = true
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = c.relname
        and p.cmd in ('SELECT','ALL')
        and (p.roles::text[] && array['public','anon'])
    );
$$;

-- Detector: raise P1 per unreachable table, resolve any table that has since been fixed.
create or replace function public.mon_detect_rls_reachability()
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare r record; n int := 0;
begin
  -- raise for every currently-unreachable listing table
  for r in select tbl from public.mon_rls_unreachable_tables() loop
    n := n + public.mon_raise(
      'P1', 'rls_unreachable', r.tbl, 'rls_unreachable:'||r.tbl,
      jsonb_build_object(
        'table', r.tbl,
        'why', 'Listing table has RLS enabled but no public/anon SELECT policy; anonymous '
               || 'users (the real app) receive 0 rows while the search index still counts them '
               || '-> phantom cards + inflated matchTotal. This is the aqarmonthly_residential_'
               || 'listings class fixed 2026-07-17. Fix: add a "for select to public using (active=true)" policy.'
      ));
  end loop;

  -- auto-resolve: any open rls_unreachable alert whose table is no longer unreachable
  perform public.mon_resolve('rls_unreachable', a.platform)
  from (
    select distinct platform
    from public.alert_event
    where kind = 'rls_unreachable' and resolved_at is null
  ) a
  where a.platform not in (select tbl from public.mon_rls_unreachable_tables());

  return n;
end $$;

-- Register as the 12th detector in the single orchestrator (cron jobid 38).
-- Body preserved verbatim; only the new detector `l` is added.
create or replace function public.mon_run_all_detectors()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; j int; k int; l int;
begin
  a := public.mon_detect_silent_scraper_death();
  b := public.mon_detect_zero_new_stall();
  c := public.mon_detect_stale_active_fraction();
  d := public.mon_detect_volume_drop();
  e := public.mon_detect_cron_health();
  f := public.mon_detect_stale_refresh();
  g := public.mon_detect_legacy_alert_tables();
  h := public.mon_detect_field_integrity();
  i := public.mon_detect_search_index_freshness();
  j := public.mon_detect_quarantine_growth();
  k := public.mon_detect_registry_orphans();
  l := public.mon_detect_rls_reachability();
  return jsonb_build_object('silent_scraper_death',a,'zero_new_stall',b,'stale_active',c,
    'volume_drop',d,'cron_health',e,'stale_refresh',f,'legacy_alert_tables',g,
    'field_integrity',h,'search_index_freshness',i,'quarantine_growth',j,
    'registry_orphans',k,'rls_reachability',l,'ran_at',now());
end $function$;