-- =============================================================================================
-- A single regressed detector could roll back the ENTIRE monitoring sweep.
-- (routine #7 systems-seam, 2026-09-15)
--
-- WHAT BROKE, MEASURED.
--   mon_detect_card_label_contract ran 8-10s for weeks. From 2026-09-14 22:29 to 2026-09-15
--   06:59 it ran 455-553s on EVERY sweep (18 consecutive), triggered by a numbered district
--   value «الصفا(2)» reaching search_listings_ar (root cause fixed upstream, commit 3620e4c).
--   The sweep went ~180s -> 620-705s and TWICE (01:59, 05:59) hit the 900s statement_timeout.
--   pg_cron runs the whole command in ONE transaction, so each abort rolled back every alert
--   that sweep had already raised AND skipped dispatch entirely: two half-hours with no
--   monitoring and no delivery, leaving no trace outside cron.job_run_details.
--   Collateral: 10-11 minute sweeps starved pg_cron's worker pool and 13 jobs lost scheduled
--   runs (cron_absent x13), including sync-search-listings-ar at 14 of 24.
--
-- WHY THE EXISTING GUARD DID NOT STOP IT.
--   mon_run_all_detectors() already has a budget guard and it is the right idea: before each
--   detector it asks "will this still fit?" and skips -- loudly, P1 detector_sweep_soft_deadline
--   -- if not, so the alerts already raised can COMMIT. Its only lever is that PRE-FLIGHT
--   prediction, and the prediction was the detector's p90 over SEVEN DAYS. 18 bad runs out of
--   ~330 samples is 5.4%: nowhere near enough to move a 90th percentile. So the guard predicted
--   ~10s for a detector taking 500s, let it start every single time, and once started nothing
--   can bound it -- statement_timeout is armed by the TOP-LEVEL statement and the whole sweep is
--   one statement. Verified empirically on THIS database before writing this migration:
--   set_config('statement_timeout','2s',true) around an inner pg_sleep(6) did not interrupt it
--   (elapsed 6.01s). A per-detector timeout is therefore not available here. The prediction is
--   the only lever, so the prediction must be able to see a step change.
--
-- THE FIX (three parts).
--   1. Predicted cost becomes greatest(p90 over 7 days, max of the last 3 real runs), so a step
--      change is visible on the NEXT sweep instead of never. Counterfactual against the measured
--      incident: card_label began at 113-184s elapsed, and 113+480=593 < 810, so it still RUNS
--      in the merely-slow sweeps -- this deliberately does NOT over-skip. In the two sweeps that
--      actually aborted it must have started past 400s elapsed, where 400+480=880 > 810 ->
--      SKIPPED, sweep commits, dispatch runs. Precisely the case that was breaking.
--   2. LIMB 5 names the REGRESSED DETECTOR. Without it the only signal is "the sweep is slow"
--      and attributing that costs a hand-written query every time.
--   3. LIMB 6 closes the hazard part 1 introduces. Skipping more readily means a detector could
--      in principle stay skipped forever -- a dark detector, the exact shape this repo has been
--      burned by (nine dark detectors reading as a clean bill of health, 2026-08-10). A detector
--      skipped in 6 consecutive sweeps (~3h) is now a P1 BY NAME.
--
-- Both functions are needle-edited from the LIVE pg_get_functiondef body, per the hard rail
-- against full-body replace from a stale copy, and every needle is asserted present first so
-- this migration FAILS CLOSED if either function moved underneath it.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- PART 1 - mon_run_all_detectors(): recency-aware cost prediction.
-- ---------------------------------------------------------------------------------------------
do $mig$
declare
  v_src text;
  v_old text;
  v_new text;
begin
  v_src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);

  -- Needle A: the aggregate that builds the cost map.
  v_old := $n$jsonb_object_agg(detector, p90)$n$;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'needle A (cost aggregate) not found exactly once in mon_run_all_detectors() - re-derive this migration from the LIVE body';
  end if;
  v_src := replace(v_src, v_old,
    $n$jsonb_object_agg(detector, greatest(p90, coalesce(recent_max, 0)))$n$);

  -- Needle B: the subquery that computes p90, which must also compute the recent maximum.
  v_old := $n$    from (select detector,
                 percentile_disc(0.9) within group (order by elapsed_ms) as p90
            from public.ops_detector_timing
           where swept_at > now() - interval '7 days'
             and not skipped
             and coalesce(crashed, false) = false
           group by detector) s;$n$;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'needle B (p90 subquery) not found exactly once in mon_run_all_detectors() - re-derive this migration from the LIVE body';
  end if;

  -- RECENCY-AWARE COST (2026-09-15). p90-over-7-days alone cannot see a step change: it is a
  -- 90th percentile over ~330 samples, so a detector that regressed 50x nine hours ago still
  -- predicts its healthy cost. Taking the greatest of the long-run p90 and the last 3 real runs
  -- keeps the stable estimate for steady detectors while letting a regression show up on the
  -- very next sweep. Skipped rows carry elapsed_ms = 0 and crashed rows are partial, so both
  -- stay excluded -- otherwise one skip would reset the estimate to zero and re-arm the bug.
  v_new := $n$    from (select detector,
                 percentile_disc(0.9) within group (order by elapsed_ms) as p90,
                 max(elapsed_ms) filter (where rn <= 3) as recent_max
            from (select detector, elapsed_ms,
                         row_number() over (partition by detector
                                                order by swept_at desc) as rn
                    from public.ops_detector_timing
                   where swept_at > now() - interval '7 days'
                     and not skipped
                     and coalesce(crashed, false) = false) q
           group by detector) s;$n$;
  v_src := replace(v_src, v_old, v_new);

  execute v_src;
end $mig$;

-- ---------------------------------------------------------------------------------------------
-- PART 2 - mon_detect_detector_sweep_budget(): LIMB 5 (cost step change) + LIMB 6 (dark skip).
-- ---------------------------------------------------------------------------------------------
do $mig$
declare
  v_src text;
  v_old text;
  v_new text;
begin
  v_src := pg_get_functiondef('public.mon_detect_detector_sweep_budget()'::regprocedure);

  -- Needle C: add the loop variable the two new limbs need.
  v_old := E'  n int := 0;\nbegin\n';
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'needle C (declare block) not found exactly once in mon_detect_detector_sweep_budget()';
  end if;
  v_src := replace(v_src, v_old, E'  n int := 0;\n  r_rec      record;\nbegin\n');

  -- Needle D: the final return, which both new limbs are inserted ahead of.
  v_old := E'\n  return n;\nend $function$';
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'needle D (final return) not found exactly once in mon_detect_detector_sweep_budget()';
  end if;

  v_new := $n$
  -- LIMB 5 (P2): a DETECTOR whose cost stepped far above its OWN baseline.
  -- Limbs 1-4 all measure the sweep as a whole, so the loudest thing they can say is "the sweep
  -- is slow" -- true, unattributed, and identical whichever detector caused it. On 2026-09-15 the
  -- attribution cost a hand-written query over ops_detector_timing while two sweeps had already
  -- aborted. This limb does that attribution every sweep and names the detector.
  --
  -- The threshold is a ratio AND an absolute floor. Ratio alone is meaningless on cheap
  -- detectors, where 8ms -> 60ms is 7.5x and costs nothing; the 60s floor keeps this to
  -- regressions that can actually threaten the budget. Calibrated on the live roster the day it
  -- shipped: 0 of 208 detectors match, and the incident's own detector matched at ~61x.
  for r_rec in
    with w as (
      select detector, elapsed_ms,
             row_number() over (partition by detector order by swept_at desc) as rn
        from public.ops_detector_timing
       where swept_at > now() - interval '7 days'
         and not skipped and coalesce(crashed, false) = false)
    select detector,
           percentile_disc(0.5) within group (order by elapsed_ms) as p50_ms,
           max(elapsed_ms) filter (where rn <= 3)                  as recent_ms
      from w group by detector
  loop
    if r_rec.recent_ms is not null
       and r_rec.recent_ms > greatest(5 * r_rec.p50_ms, 60000) then
      n := n + public.mon_raise('P2','detector_sweep_budget','monitoring',
        'detector_cost_step_change:' || r_rec.detector,
        jsonb_build_object(
          'detector', r_rec.detector,
          'baseline_p50_ms', round(r_rec.p50_ms),
          'recent_max_ms', round(r_rec.recent_ms),
          'ratio', round(r_rec.recent_ms / greatest(r_rec.p50_ms, 1), 1),
          'why','this detector now costs many times what it used to. The sweep runs in ONE '
             ||'transaction under a statement_timeout, so a detector that grows without bound '
             ||'does not just slow things down -- it can take the whole sweep past the ceiling, '
             ||'rolling back every alert already raised and skipping dispatch. It also holds a '
             ||'pg_cron worker for its whole runtime, which is how 13 unrelated jobs lost '
             ||'scheduled runs on 2026-09-15.',
          'action','root-cause the detector''s own query. Its cost usually tracks a DATA change '
             ||'upstream (on 2026-09-15 a numbered district value made a district-split CTE 50x '
             ||'more expensive), so look at what its inputs did before rewriting the detector. '
             ||'Do NOT silence this by removing the detector from the roster.'));
    else
      perform public.mon_resolve_key('detector_sweep_budget',
        'detector_cost_step_change:' || r_rec.detector);
    end if;
  end loop;

  -- LIMB 6 (P1): a detector the budget guard has SKIPPED for many consecutive sweeps.
  -- The guard skips deliberately so that the alerts already raised can commit -- that is correct
  -- and must stay. But a skipped detector is NOT green, it is UNMEASURED, and the existing
  -- soft-deadline alert says only how MANY were skipped in the last sweep. A detector that is
  -- skipped every single sweep is a dark detector, which is the failure this whole monitoring
  -- system has been burned by before (nine dark detectors reading as a clean bill of health,
  -- 2026-08-10). Six consecutive sweeps is ~3 hours of that detector never running.
  for r_rec in
    with recent_sweeps as (
      select distinct swept_at
        from public.ops_detector_timing
       where swept_at > now() - interval '24 hours'
       order by swept_at desc limit 6)
    select t.detector,
           count(*)                                              as seen_n,
           count(*) filter (where t.skipped)                     as skipped_n,
           max(case when not t.skipped then t.swept_at end)      as last_real_run
      from public.ops_detector_timing t
      join recent_sweeps rs on rs.swept_at = t.swept_at
     group by t.detector
  loop
    if r_rec.seen_n >= 6 and r_rec.skipped_n >= 6 then
      n := n + public.mon_raise('P1','detector_sweep_budget','monitoring',
        'detector_persistently_skipped:' || r_rec.detector,
        jsonb_build_object(
          'detector', r_rec.detector,
          'consecutive_sweeps_skipped', r_rec.skipped_n,
          'last_real_run', r_rec.last_real_run,
          'why','the budget guard has skipped this detector in every one of the last 6 sweeps, '
             ||'so it has not actually evaluated its condition for ~3 hours. A skipped detector '
             ||'is not green, it is UNMEASURED -- whatever it watches is currently unwatched, '
             ||'and its roster count of 0 reads exactly like a clean result.',
          'action','make the sweep fit: root-cause whichever detector is eating the budget '
             ||'(see detector_cost_step_change) or slim this one. NEVER resolve this by '
             ||'dropping the detector from the roster or by widening the sweep budget to hide '
             ||'it.'));
    else
      perform public.mon_resolve_key('detector_sweep_budget',
        'detector_persistently_skipped:' || r_rec.detector);
    end if;
  end loop;

  -- ORPHANED-KEY SWEEP for the two limbs above. Both resolve INSIDE a loop driven by detectors
  -- that still appear in ops_detector_timing, so a key belonging to a detector since removed
  -- from the roster is unreachable -- and while it sits open, mon_raise() returns 0 for that
  -- key, so a detector re-added under the same name would raise nothing at all. This is the
  -- same trap mon_detect_cron_health() documents for deleted jobids. The discriminator is
  -- whether the detector still runs, which is the same fact that made the key unreachable.
  update public.alert_event a
     set resolved_at = now()
   where a.kind = 'detector_sweep_budget'
     and a.resolved_at is null
     and (a.dedup_key like 'detector_cost_step_change:%'
       or a.dedup_key like 'detector_persistently_skipped:%')
     and not exists (
       select 1 from public.ops_detector_timing t
        where t.detector = split_part(a.dedup_key, ':', 2)
          and t.swept_at > now() - interval '24 hours');
$n$ || E'\n  return n;\nend $function$';

  v_src := replace(v_src, v_old, v_new);
  execute v_src;
end $mig$;