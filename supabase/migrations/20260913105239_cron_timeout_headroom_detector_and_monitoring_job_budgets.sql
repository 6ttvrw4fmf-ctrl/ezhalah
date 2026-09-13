-- A MONITORING JOB THAT OUTGROWS ITS OWN statement_timeout GOES DARK SILENTLY (routine #7, 2026-09-13).
--
-- Measured this run across the live roster: SEVEN active jobs sat at >= 88% of their effective
-- statement_timeout, six of them monitoring jobs, and the failures had already started:
--
--   jobid 63 mon-aqar-ppm-as-total     no timeout set -> 120s global, max success 115.4s (96.2%), 4 aborts/7d
--   jobid 42 mon-price-fidelity        no timeout set -> 120s global, max success 116.2s (96.8%), 1 abort/7d
--   jobid 50 refresh-mon-audit-counts  180s,                          max success 170.4s (94.7%), 3 aborts/7d
--   jobid 77 mon-trending-cohort-drift no timeout set -> 120s global, max success 113.4s (94.5%)
--   jobid 34 location-pipeline-monitor no timeout set -> 120s global, max success 110.7s (92.3%), 2 aborts/7d
--   jobid 28 sync-search-listings-ar   600s,                          max success 611.0s (101.8%)
--   jobid 38 mon-detectors-and-dispatch 900s,                         max success 797.9s (88.7%)
--
-- Every abort is one period in which that detector performed NO detection at all. mon_detect_cron_health()
-- sees them, but only AFTER the fact and only as a generic failure: limb 1 needs the most recent completed
-- run to have failed, limb 2 needs >= 2 failures in 24h, and neither can distinguish "ran out of budget"
-- (give it headroom) from "hit a real error" (fix the code). Nothing anywhere watched the approach.
--
-- This adds the PROACTIVE half and fixes the five monitoring jobs whose budgets are demonstrably too small.
-- Deliberately NOT touched here: jobid 28 (search-index sync — a data pipeline owned by routines #3/#4) and
-- jobid 38 (the detector sweep itself, where docs/ops/SYSTEMS_SEAM_ENGINEER.md says the remedy is to make the
-- sweep FASTER or ask the owner for a minute-slot, never to widen a budget). The new detector reports both,
-- which is the honest outcome rather than a quiet one.
--
-- NOTE: these are COMMAND edits, not SCHEDULE edits. Every schedule string below is byte-identical to the
-- live one — a cron schedule change is owner-only and none is made here.

-- ---------------------------------------------------------------------------------------------
-- 1. Give the five monitoring jobs real headroom (~5x observed max, still far inside their interval).
-- ---------------------------------------------------------------------------------------------
select cron.schedule('location-pipeline-monitor', '17 * * * *',
  $$set statement_timeout to '600s'; select public.location_pipeline_monitor();$$);
select cron.schedule('mon-price-fidelity', '47 * * * *',
  $$set statement_timeout to '600s'; select public.mon_detect_price_fidelity();$$);
select cron.schedule('refresh-mon-audit-counts', '22,52 * * * *',
  $$set statement_timeout to '600s'; select public.refresh_mon_audit_counts();$$);
select cron.schedule('mon-aqar-ppm-as-total', '25 * * * *',
  $$set statement_timeout to '600s'; select public.mon_detect_aqar_ppm_as_total();$$);
select cron.schedule('mon-trending-cohort-drift', '37 */6 * * *',
  $$set statement_timeout to '600s'; select mon_detect_trending_cohort_drift();$$);

-- ---------------------------------------------------------------------------------------------
-- 2. The barrier.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mon_detect_cron_timeout_headroom()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  rec record;
  n int := 0;
  c_warn_pct numeric := 85;      -- a job at/above this share of its budget is one slow day from aborting
  v_default_ms numeric;
begin
  -- The fallback budget must be the value a FRESH session gets, not this session's. pg_settings.reset_val
  -- is exactly that and is immune to a `set statement_timeout` upstream in the caller's command — which
  -- matters here because this detector runs from mon-detectors-and-dispatch, whose own command sets 900s.
  -- Reading current_setting() instead would judge every un-budgeted job against 900s rather than its real
  -- 120s, i.e. the detector would report headroom that does not exist.
  select reset_val::numeric into v_default_ms from pg_settings where name = 'statement_timeout';

  for rec in
    with eff as (
      select j.jobid, j.jobname,
             case
               -- an explicit, parseable budget in the command wins
               when (regexp_match(j.command, 'statement_timeout\s*(?:to|=)\s*''?\s*([0-9]+)\s*s', 'i')) is not null
                 then (regexp_match(j.command, 'statement_timeout\s*(?:to|=)\s*''?\s*([0-9]+)\s*s', 'i'))[1]::numeric
               -- it SETS one but in a shape we cannot read: UNKNOWN, never "assume the default".
               -- Judging it against the wrong budget would be a confident wrong answer, so skip it.
               when j.command ~* 'statement_timeout' then null
               else v_default_ms / 1000.0
             end as timeout_s
      from cron.job j
      where j.active
    ),
    d as (
      select jobid,
             max(extract(epoch from (end_time - start_time)))
               filter (where status = 'succeeded') as max_ok_s,
             count(*) filter (where status = 'failed'
                                and return_message ilike '%statement timeout%') as timeout_fails_24h
      from cron.job_run_details
      where start_time > now() - interval '24 hours'
        and end_time is not null
      group by jobid
    )
    select e.jobid, e.jobname, e.timeout_s, d.max_ok_s,
           coalesce(d.timeout_fails_24h, 0) as timeout_fails_24h
    from eff e
    join d on d.jobid = e.jobid
    where e.timeout_s is not null and e.timeout_s > 0
  loop
    -- LIMB 1 — HEADROOM EXHAUSTED (P2). The job still succeeds, so every other check reads green;
    -- this is the only thing that speaks before the first abort.
    if rec.max_ok_s is not null and rec.max_ok_s >= (c_warn_pct / 100.0) * rec.timeout_s then
      n := n + public.mon_raise('P2', 'cron_timeout_headroom', null,
        'cron_timeout_headroom:' || rec.jobid,
        jsonb_build_object('jobid', rec.jobid, 'job', rec.jobname,
          'timeout_s', rec.timeout_s,
          'max_successful_run_s', round(rec.max_ok_s::numeric, 1),
          'pct_of_budget', round(100 * rec.max_ok_s::numeric / rec.timeout_s, 1),
          'why', 'This job''s slowest SUCCESSFUL run in 24h is within ' || (100 - c_warn_pct)
              || '% of the statement_timeout it runs under. It has not failed yet, so cron_health '
              || 'and every point-in-time check read green — but the next slow run aborts, and an '
              || 'aborted monitoring job performs NO detection for that period while still leaving '
              || 'a roster count of 0.',
          'action', 'Raise the budget in the job''s COMMAND (set statement_timeout to ''Ns''), or make '
              || 'the query cheaper. A cron SCHEDULE change is owner-only. Never silence this by '
              || 'widening c_warn_pct.'));
    else
      perform public.mon_resolve_key('cron_timeout_headroom', 'cron_timeout_headroom:' || rec.jobid);
    end if;

    -- LIMB 2 — ALREADY ABORTING ON BUDGET (P1). cron_health limb 1/2 also fire on these, but cannot say
    -- WHY. This limb matches the return_message, so the finding is actionable rather than generic:
    -- a budget abort is fixed by headroom, a logic error is not.
    if rec.timeout_fails_24h > 0 then
      n := n + public.mon_raise('P1', 'cron_timeout_headroom', null,
        'cron_timeout_abort:' || rec.jobid,
        jsonb_build_object('jobid', rec.jobid, 'job', rec.jobname,
          'timeout_s', rec.timeout_s,
          'timeout_aborts_24h', rec.timeout_fails_24h,
          'why', 'This job was KILLED by statement_timeout in the last 24h — not a logic error. Each '
              || 'abort is one scheduled period that did no work at all, and pg_cron runs the whole '
              || 'command in ONE transaction, so anything the command would have written rolled back '
              || 'with it.',
          'action', 'Raise the budget in the job''s COMMAND, or make the query cheaper.'));
    else
      perform public.mon_resolve_key('cron_timeout_headroom', 'cron_timeout_abort:' || rec.jobid);
    end if;
  end loop;

  -- ORPHANED-KEY SWEEP. Both resolves above live inside the per-job loop, so a key belonging to a job
  -- that has since been DELETED is unreachable and would sit open forever — suppressing every future
  -- raise for that key, because mon_raise() returns 0 on an already-open dedup_key and pg_cron REUSES
  -- jobids. Same failure mon_detect_cron_health() was repaired for (alert 2419, 48 sweeps). This is a
  -- resolve on an EVALUATED path: the discriminator is whether the job still exists, which is the same
  -- fact that made the key unreachable. Never widen this to resolve keys for jobs that DO exist.
  update public.alert_event a
     set resolved_at = now()
   where a.kind = 'cron_timeout_headroom'
     and a.resolved_at is null
     and a.dedup_key ~ '^cron_timeout_[a-z]+:[0-9]+$'
     and not exists (select 1 from cron.job j
                      where j.jobid = split_part(a.dedup_key, ':', 2)::bigint);

  return n;
end $function$;

-- ---------------------------------------------------------------------------------------------
-- 3. Roster entry, in the SAME migration. A detector outside mon_run_all_detectors() is decoration:
--    mon_detect_orphaned_detectors() fires on any detector nothing reaches. Needle-edited off the
--    LIVE body so a concurrent session's own roster addition fails loudly instead of being clobbered.
-- ---------------------------------------------------------------------------------------------
do $mig$
declare
  src text;
  new_src text;
begin
  select pg_get_functiondef('mon_run_all_detectors'::regproc) into src;
  new_src := replace(src,
    $q$'mon_detect_amlakalahsa_jafr_dahiya_merge_regressed'
  ];$q$,
    $q$'mon_detect_amlakalahsa_jafr_dahiya_merge_regressed',
    'mon_detect_cron_timeout_headroom'
  ];$q$);
  if new_src = src then
    raise exception 'mon_run_all_detectors roster tail changed shape — needle not found, aborting rather than guessing';
  end if;
  execute new_src;
end $mig$;

-- ---------------------------------------------------------------------------------------------
-- 4. Prove it in-migration: the detector must RUN, and it must be reachable from the roster.
--    Deliberately NOT asserted to return 0 — jobids 28 and 38 are genuinely above the threshold and
--    SHOULD raise. A barrier that only ships when it is silent is a barrier nobody has seen work.
-- ---------------------------------------------------------------------------------------------
do $verify$
declare
  raised int;
begin
  select public.mon_detect_cron_timeout_headroom() into raised;
  if raised is null then
    raise exception 'mon_detect_cron_timeout_headroom returned NULL';
  end if;
  if pg_get_functiondef('mon_run_all_detectors'::regproc) not like '%mon_detect_cron_timeout_headroom%' then
    raise exception 'detector is not on the mon_run_all_detectors roster';
  end if;
  raise notice 'mon_detect_cron_timeout_headroom raised % alert(s) on first run', raised;
end $verify$;
