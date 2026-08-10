-- Fix a self-inflicted leak found live 2026-08-10: mon_selftest_reconcile_dangling_scrape_runs()
-- (this same PR, migration 20260810130112) inserts fixture rows into scrape_runs for the fake
-- platform '__selftest__dangling_reconcile' and cleans them up afterward — but an existing trigger
-- auto-registers any platform seen in scrape_runs into platform_registry, and the self-test never
-- reverses THAT side effect. Applying the migration to production therefore left a permanent
-- platform_registry row with zero real scrape_runs, which mon_detect_registry_orphans() correctly
-- flagged as a P2 "dead registry entry" (alert_event id 406) a few hours later — a real, if minor,
-- bug in the self-test, not a false positive from the detector.
--
-- One-time cleanup: remove the row already left behind in production.
delete from public.platform_registry where platform = '__selftest__dangling_reconcile';

-- Permanent fix: the self-test now also deletes its own platform_registry row, both before running
-- (idempotent against a previous partial run) and after, so a future re-run of this self-test can
-- never leave the same residue again.
create or replace function public.mon_selftest_reconcile_dangling_scrape_runs() returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_platform constant text := '__selftest__dangling_reconcile';
  v_old_id bigint; v_young_id bigint; v_closed_id bigint;
  v_ok boolean := true;
begin
  delete from public.scrape_runs where platform = v_platform;
  delete from public.platform_registry where platform = v_platform;

  insert into public.scrape_runs(platform, started_at) values (v_platform, now() - interval '13 hours') returning id into v_old_id;
  insert into public.scrape_runs(platform, started_at) values (v_platform, now() - interval '1 hour') returning id into v_young_id;
  insert into public.scrape_runs(platform, started_at, finished_at, ok, rows_seen)
    values (v_platform, now() - interval '20 hours', now() - interval '19 hours', true, 42) returning id into v_closed_id;

  perform public.mon_reconcile_dangling_scrape_runs();

  if not exists (select 1 from public.scrape_runs where id = v_old_id and ok = false and finished_at is not null) then
    v_ok := false;  -- the >12h dangling row must be closed
  end if;
  if not exists (select 1 from public.scrape_runs where id = v_young_id and ok is null and finished_at is null) then
    v_ok := false;  -- the <12h row must be left alone (still legitimately running)
  end if;
  if not exists (select 1 from public.scrape_runs where id = v_closed_id and ok = true and rows_seen = 42) then
    v_ok := false;  -- an already-finalized run must never be overwritten
  end if;

  delete from public.scrape_runs where platform = v_platform;
  delete from public.platform_registry where platform = v_platform;
  return v_ok;
end $function$;

comment on function public.mon_selftest_reconcile_dangling_scrape_runs() is
  'Regression guard: proves mon_reconcile_dangling_scrape_runs() closes only rows past the 12h '
  'cutoff, leaves younger ones alone, and never touches an already-finalized run. Self-cleaning '
  '(scrape_runs AND platform_registry — the latter added 2026-08-10 after a leaked fixture row '
  'triggered a real registry_orphans alert), safe to run on production.';

-- Re-run it now so a fresh apply of this migration immediately proves the fixed version still
-- passes and leaves nothing behind.
do $verify$
begin
  if not public.mon_selftest_reconcile_dangling_scrape_runs() then
    raise exception 'mon_selftest_reconcile_dangling_scrape_runs FAILED after the registry-cleanup fix';
  end if;
  if exists (select 1 from public.platform_registry where platform = '__selftest__dangling_reconcile') then
    raise exception 'self-test left a platform_registry row behind — the fix did not work';
  end if;
  raise notice 'mon_selftest_reconcile_dangling_scrape_runs passed and left no platform_registry residue';
end $verify$;
