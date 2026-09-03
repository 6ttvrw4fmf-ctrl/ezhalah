-- P0 DETECTION WAS TRAPPED INSIDE THE FULL SWEEP'S TRANSACTION (routine #7, owner-approved
-- 2026-08-31, issue #1408).
--
-- THE DEFECT. cron.job 38 (`mon-detectors-and-dispatch`) runs five statements as ONE command
-- string, and pg_cron executes that in ONE transaction:
--     set statement_timeout to '900s';
--     select mon_dispatch_p0_fast();
--     select mon_reconcile_dangling_scrape_runs();
--     select mon_run_all_detectors();      <- every P0 is born here
--     select mon_dispatch_alerts();
--     select mon_dispatch_p0_fast();
-- `mon-p0-fast-lane` (job 86) is a SEPARATE SESSION, so under ordinary MVCC it cannot see a P0
-- raised inside job 38 until job 38 COMMITS. The trailing in-sweep dispatch does not rescue it
-- either: pg_net queues the POST and only sends after commit. Measured over 24h, job 38 runs
-- avg 207s / p95 430s / max 712s -- so a P0 was invisible and undispatchable for up to 712s
-- against a 300s SLO, before the destination had done anything at all.
--
-- This is why the 2026-08-30 decoupling (giving the lane its own 24 minute-slots) did not, on its
-- own, remove sweep duration from the P0 path. It removed the SERIALISATION of dispatch behind the
-- sweep within one command; it could not remove transaction VISIBILITY. The spec's claim that
-- sweep duration is "no longer a term at all" was wrong on that point.
--
-- THE FIX, AND WHY IT IS CHEAP. Measured over 7 days, ALL TEN P0-capable detectors cost ~1.1s
-- summed worst case (silent_scraper_death 0.85s max dominates; the other nine are <=0.11s each),
-- and none is on the ops_detector_last_full_run 20h expensive gate -- that gate holds only P1/P2
-- audit detectors. The 430s p95 is entirely non-P0 audit work. So P0 detection can simply move
-- into job 86's already-short transaction (measured 8ms avg / 131ms max over 567 runs, 0 failures,
-- bounded by its own 45s statement_timeout), which commits in about a second.
--
-- Result: a P0 is now BORN, COMMITTED and DISPATCH-TRIGGERED inside one short transaction, at a
-- worst-case 3-minute cadence. Job 38's duration is no longer on the P0 path at any point -- not
-- as a transaction the alert is trapped inside, and not as a dependency. A 712s sweep becomes
-- irrelevant to P0 delivery instead of dominant.
--
-- NOTHING IS WEAKENED. No detector changes, no threshold moves, no SLO widens. The ten detectors
-- STAY on the full-sweep roster as well -- mon_raise() dedups on dedup_key, so double-running is
-- idempotent and the sweep remains a defence-in-depth backstop if the lane ever stops. The full
-- sweep keeps mon_reconcile_dangling_scrape_runs(), all 141 detectors, mon_dispatch_alerts() and
-- both fast-lane calls, unchanged.
--
-- ORDERING WAS CHECKED, NOT ASSUMED. The one candidate dependency was
-- mon_detect_silent_scraper_death() vs mon_reconcile_dangling_scrape_runs(), which precedes it in
-- job 38. It reads only scrape_runs aggregates
-- (max(started_at) filter (where ok and rows_seen > 0)); reconciling a dangling run can only set
-- ok=false, which cannot change the "last healthy is too old" predicate. No P0 detector consumes
-- state an earlier sweep step writes.
--
-- PER-DETECTOR EXCEPTION ISOLATION IS LOAD-BEARING HERE. In the sweep, a detector raising an
-- exception is one bad detector. In this lane an uncaught exception would roll back the
-- transaction AND the dispatch that follows it in the same command -- turning a detector bug into
-- a delivery outage. Each call is therefore wrapped, and a crash is counted and reported rather
-- than propagated.
--
-- DELIBERATELY NOT WRITING ops_detector_timing. This lane runs 24x/hour; per-detector timing rows
-- would grow that table ~12x for these ten detectors. The lane's real cost is already recorded,
-- for free and per run, in cron.job_run_details for jobid 86 -- which is the signal
-- scripts/verify-p0-fast-lane-detection.ts checks.

create or replace function public.mon_run_p0_detectors()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- EVERY P0-capable detector. This list is machine-checked against reality by
  -- scripts/verify-p0-fast-lane-detection.ts, which enumerates every public mon_detect_* whose
  -- body can raise 'P0' and FAILS if one is missing here. That barrier is the point: a new P0
  -- detector added to the sweep but not to this lane would silently inherit the 712s latency this
  -- migration exists to remove, and nothing else would notice.
  c_p0_detectors constant text[] := array[
    'mon_detect_agent_calls_per_message',
    'mon_detect_agent_health',
    'mon_detect_ai_cost_health',
    'mon_detect_alert_delivery',
    'mon_detect_deleted_but_source_live',
    'mon_detect_deletion_on_inconclusive_evidence',
    'mon_detect_p0_delivery_sla',
    'mon_detect_silent_scraper_death',
    'mon_detect_unacknowledged_p0',
    'mon_detect_unledgered_hard_delete'
  ];
  d           text;
  v_raised    int := 0;
  v_one       int;
  v_crashed   text[] := '{}'::text[];
  v_missing   text[] := '{}'::text[];
begin
  foreach d in array c_p0_detectors loop
    if not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = d
    ) then
      -- A renamed or dropped detector must be loud, never a silent gap in P0 coverage.
      v_missing := v_missing || d;
      continue;
    end if;
    begin
      execute format('select public.%I()', d) into v_one;
      v_raised := v_raised + coalesce(v_one, 0);
    exception when others then
      -- Never let one detector abort the lane: the dispatch call that follows in the same cron
      -- command would roll back with it.
      v_crashed := v_crashed || (d || ': ' || sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'raised',   v_raised,
    'checked',  array_length(c_p0_detectors, 1),
    'crashed',  v_crashed,
    'missing',  v_missing);
end $function$;

comment on function public.mon_run_p0_detectors() is
  'The P0-critical detector subset, run on the fast lane (cron jobid 86) in its own SHORT '
  'transaction so a P0 is born, committed and dispatch-triggered without waiting on the full '
  'sweep (jobid 38), whose transaction hid new P0 rows from the lane for up to 712s. These ten '
  'also stay on the full-sweep roster; mon_raise() dedups, so the sweep remains a backstop. '
  'Membership is enforced by scripts/verify-p0-fast-lane-detection.ts against every mon_detect_* '
  'that can raise P0. Each call is exception-isolated so a detector bug cannot roll back dispatch.';

-- Chain detection ahead of dispatch on the EXISTING fast lane. The SCHEDULE IS NOT TOUCHED --
-- cron.alter_job is passed only `command`, so job 86 keeps its 24 owner-approved minute slots
-- (worst gap 3 minutes including the wrap past the top of the hour) and its 45s statement_timeout.
do $cron$
declare v_sched text; v_cmd text;
begin
  select schedule, command into v_sched, v_cmd from cron.job where jobid = 86;
  if v_sched is null then
    raise exception 'cron jobid 86 (mon-p0-fast-lane) not found - refusing to guess at the P0 lane';
  end if;
  if position('mon_dispatch_p0_fast' in v_cmd) = 0 then
    raise exception 'jobid 86 no longer calls mon_dispatch_p0_fast - the lane moved; refusing to edit blind';
  end if;
  if position('mon_run_p0_detectors' in v_cmd) > 0 then
    raise notice 'jobid 86 already runs mon_run_p0_detectors - no change';
    return;
  end if;

  perform cron.alter_job(
    job_id  := 86,
    command := E'\n    set statement_timeout to \'45s\';\n'
            || E'    select public.mon_run_p0_detectors();\n'
            || E'    select public.mon_dispatch_p0_fast();\n  ');

  -- Prove the schedule survived: this migration must never become a schedule change.
  if (select schedule from cron.job where jobid = 86) is distinct from v_sched then
    raise exception 'jobid 86 schedule changed (% -> %) - that is owner-only and was not intended',
      v_sched, (select schedule from cron.job where jobid = 86);
  end if;
  raise notice 'jobid 86: P0 detection chained ahead of dispatch; schedule unchanged (%)', v_sched;
end $cron$;