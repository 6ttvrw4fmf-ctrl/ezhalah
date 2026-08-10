-- ROOT CAUSE (2026-08-10 daily engineer follow-up): scrape_runs rows abandoned by a SIGKILL/OOM/
-- lost-runner (the class scrapers/common/db.py's in-process SIGTERM handler cannot catch — see
-- reconcile_orphaned_runs() there) are only ever closed REACTIVELY, inside the NEXT begin_run()
-- call for that EXACT platform. For a platform that scrapes often (many times/hour) that lag is
-- small. For aqar_residential, which is scheduled every 8 hours (cron.job 'gh-aqar-sweep',
-- '5 */8 * * *'), a row that dangles right after one sweep starts can sit at ok=NULL for up to
-- ~8h before the NEXT sweep's begin_run() even attempts reconciliation, and reconciliation itself
-- is gated at 12h old (ORPHAN_RUN_HOURS) — so in the worst case a dangling row (and the P1
-- `dangling_scrape_run` alert mon_detect_dangling_scrape_run raises for it once it's 3h+ old) can
-- sit open for ~20h before anything closes it. Confirmed live: scrape_runs 26323/26326/26350/
-- 26353/26354 (aqar_residential, started 2026-08-10 00:09-00:13, the exact incident PR #389's
-- idempotent-insert fix now prevents from recurring) were STILL ok=NULL/finished_at=NULL at
-- 2026-08-10 12:30 — well past the 3h alert threshold, right at the 12h reconciliation threshold,
-- and NOT yet reconciled because aqar_residential's next sweep isn't until 16:05 UTC.
--
-- FIX: reconciliation must not depend on THAT platform happening to scrape again. This function
-- applies the identical closing semantics as Python's reconcile_orphaned_runs() (same 12h cutoff,
-- same ok=false / stamped finished_at / non-fabricated rows_seen) to EVERY platform, and is wired
-- into the existing 30-minute detector cron (mon-detectors-and-dispatch) to run immediately before
-- mon_run_all_detectors() — so a dangling row is swept up within 30 minutes of crossing 12h old,
-- system-wide, not just for aqar. Nothing is invented: rows_seen/rows_upserted are left exactly as
-- begin_run() wrote them, per the same "an honest unknown beats a fabricated number" rule as the
-- Python original.
create or replace function public.mon_reconcile_dangling_scrape_runs()
 returns integer
 language sql
 security definer
 set search_path to 'public'
as $function$
  with closed as (
    update public.scrape_runs
    set finished_at = now(),
        ok = false,
        notes = 'orphaned — presumed killed (SIGKILL/OOM/lost runner, so no in-process handler '
                'could close it); this platform had no subsequent run to trigger begin_run()''s '
                'own reconciliation within a safe window, so mon_reconcile_dangling_scrape_runs() '
                '(30-min cron) closed it instead. rows_seen/rows_upserted are NOT meaningful for '
                'this row.'
    where ok is null
      and finished_at is null
      and started_at < now() - interval '12 hours'
    returning 1
  )
  select count(*)::integer from closed;
$function$;

comment on function public.mon_reconcile_dangling_scrape_runs() is
  'Proactive, platform-agnostic backstop for scrapers/common/db.py reconcile_orphaned_runs(): '
  'closes any scrape_runs row still open past the same 12h ORPHAN_RUN_HOURS cutoff, without '
  'waiting for that specific platform to scrape again. Run every 30 min via cron.job '
  '''mon-detectors-and-dispatch'', immediately before mon_run_all_detectors().';

-- Wire it into the existing 30-minute detector cron, immediately before the detectors run, so a
-- freshly-reconciled row is never even seen as "dangling" by mon_detect_dangling_scrape_run.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'mon-detectors-and-dispatch'),
  command => $cron$
    set statement_timeout to '300s';
    select public.mon_reconcile_dangling_scrape_runs();
    select public.mon_run_all_detectors();
    select public.mon_dispatch_alerts();
  $cron$
);

-- Regression guard, self-cleaning, safe to run on production: proves the function actually closes
-- a row older than the cutoff, leaves a younger one alone, and never overwrites an already-closed
-- run (mirrors the mon_selftest_* pattern used elsewhere in this file).
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
  return v_ok;
end $function$;

comment on function public.mon_selftest_reconcile_dangling_scrape_runs() is
  'Regression guard: proves mon_reconcile_dangling_scrape_runs() closes only rows past the 12h '
  'cutoff, leaves younger ones alone, and never touches an already-finalized run. Self-cleaning, '
  'safe to run on production.';

do $do$
begin
  if not public.mon_selftest_reconcile_dangling_scrape_runs() then
    raise exception 'dangling-run reconcile self-test FAILED against the live function — refusing to ship it green';
  end if;
end $do$;

-- One-time cleanup of the 5 known-stuck aqar_residential rows from this morning's incident (now
-- well past the 12h cutoff), proving the new function works against real production data, not
-- just the self-test fixture.
select public.mon_reconcile_dangling_scrape_runs() as rows_closed_now;
