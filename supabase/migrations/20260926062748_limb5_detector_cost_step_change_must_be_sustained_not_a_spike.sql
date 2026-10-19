-- =============================================================================================
-- LIMB 5 OF mon_detect_detector_sweep_budget(): A COST STEP CHANGE MUST PERSIST.
-- Senior Production Engineer (routine-2-production), 2026-09-26.
--
-- THE DEFECT, MEASURED. LIMB 5 reports a detector whose cost has "stepped far above its OWN
-- baseline". It decided that from `max(elapsed_ms) filter (where rn <= 3)` -- the PEAK of the last
-- three sweeps -- so a single sweep in which the detector merely WAITED (a lock, concurrent DDL, a
-- busy instance) satisfied it in full. Measured over this instance's own history:
--
--   * 71 detector_cost_step_change alerts raised since the limb shipped on 2026-09-15.
--     70 of them resolved within 1-3 sweeps (60-150 min) -- i.e. inside the limb's OWN 3-sweep
--     lookback, which is the definition of a transient, not of a step change.
--     Exactly ONE was real: alert 3146, mon_detect_card_label_contract, p50 10.2s -> 460s
--     sustained, open for three days. That is the 2026-09-15 incident the limb was built for.
--   * Replaying both rules over every sweep in the trailing 11 days of ops_detector_timing:
--       current rule (peak of last 3):      204 detector-sweeps raise, across 13 detectors
--       persistence rule (2nd of last 3):     3 detector-sweeps raise, across  1 detector
--     and the one survivor is mon_detect_card_label_contract on 2026-09-15 -- the real one, kept.
--   * Today's two raises were both isolated spikes. mon_detect_phasea_offregion_pick sat at
--     12,599 ms (04:59), 65,845 ms (05:31), 12,686 ms (05:59): back at baseline on the very next
--     sweep, while the payload said it "now costs many times what it used to". At 05:31 another
--     session was applying DDL to listing_native_location_v1 (PR #4523, whose own migration that
--     same sweep blocked three times) -- so the true cause was reciprocal lock contention and the
--     alert named a detector instead.
--
-- WHY THIS IS NOT COSMETIC. mon_raise() dedups on an open key, so while a transient alert sits
-- open under 'detector_cost_step_change:<detector>', a GENUINE regression in that same detector
-- raises nothing at all. phasea_offregion_pick alone has held this key open 11 times. A limb that
-- cries wolf is also a limb that is deaf, which is the trap AGENTS.md records for a zero return
-- sitting on top of an open alert -- here one layer deeper, in the dedup key itself.
--
-- THE FIX. Require the elevation to be SUSTAINED: the SECOND-highest of the detector's last three
-- real runs must clear the bar, so >= 2 of 3 sweeps were elevated. A contention spike occupies
-- exactly one sweep and cannot satisfy it; a real regression is elevated on every sweep and always
-- does, one sweep (30 min) later than before -- immaterial against a three-day incident, and the
-- sweep-level consequence is independently alarmed the whole time by LIMB 1/3/4 and by
-- mon_detect_cron_starvation_risk().
--
-- NOTHING IS WEAKENED. The 5x ratio and the 60s absolute floor are untouched. LIMB 6
-- (detector_persistently_skipped) and the orphaned-key sweep are untouched. A detector with fewer
-- than two real runs in 7 days yields NULL and is skipped by the pre-existing `is not null` guard
-- -- it cannot demonstrate persistence, and LIMB 6 is what watches a detector that never runs.
--
-- The decision is extracted into a pure, immutable function so it can be EXECUTED against injected
-- series rather than read -- the same shape LIMB 4 already uses for
-- mon_p0_sweep_exposure_should_raise(). PART 3 executes it at apply time, including both real
-- production series above, and this migration ABORTS if any case is wrong.
--
-- The body is needle-edited from the LIVE pg_get_functiondef, per the hard rail against a
-- full-body replace from a stale copy. Every needle is asserted present exactly once first, so
-- this migration FAILS CLOSED if the function moved underneath it.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- PART 1 - the decision, as a pure function.
-- ---------------------------------------------------------------------------------------------
create or replace function public.mon_detector_cost_step_is_sustained(
  p_p50_ms      numeric,
  p_recent_desc numeric[]
) returns boolean
language sql
immutable
as $fn$
  -- p_recent_desc: this detector's last 3 real (not skipped, not crashed) elapsed_ms, sorted DESC.
  -- The SECOND element is the sustained cost: it clears the bar only when at least TWO of the three
  -- sweeps were elevated. NULL (fewer than 2 real runs) is NOT a raise -- persistence is unprovable
  -- there, and mon_detect_detector_sweep_budget() LIMB 6 is what watches a detector that never runs.
  select p_recent_desc[2] is not null
     and p_recent_desc[2] > greatest(5 * coalesce(p_p50_ms, 0), 60000);
$fn$;

comment on function public.mon_detector_cost_step_is_sustained(numeric, numeric[]) is
  'LIMB 5 of mon_detect_detector_sweep_budget(): a detector cost step change must be SUSTAINED '
  'across >= 2 of the last 3 sweeps. Decided on p_recent_desc[2] (the second-highest), never the '
  'peak: a lock-contention spike occupies exactly one sweep. 70 of the limb''s first 71 alerts were '
  'such spikes (routine-2-production, 2026-09-26). Do NOT change this to [1] / max().';

-- ---------------------------------------------------------------------------------------------
-- PART 2 - needle-edit LIMB 5 to use it.
-- ---------------------------------------------------------------------------------------------
do $mig$
declare
  v_src text;
  v_old text;
  v_new text;
begin
  v_src := pg_get_functiondef('public.mon_detect_detector_sweep_budget()'::regprocedure);

  -- Needle A: the aggregate that decides what "recent" means.
  v_old := $n$    select detector,
           percentile_disc(0.5) within group (order by elapsed_ms) as p50_ms,
           max(elapsed_ms) filter (where rn <= 3)                  as recent_ms
      from w group by detector$n$;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'needle A (LIMB 5 recent aggregate) not found exactly once - re-derive this migration from the LIVE body';
  end if;
  v_new := $n$    select detector,
           percentile_disc(0.5) within group (order by elapsed_ms) as p50_ms,
           (array_agg(elapsed_ms order by elapsed_ms desc)
              filter (where rn <= 3))                              as recent_desc,
           (array_agg(elapsed_ms order by elapsed_ms desc)
              filter (where rn <= 3))[2]                           as recent_ms,
           max(elapsed_ms) filter (where rn <= 3)                  as peak_ms
      from w group by detector$n$;
  v_src := replace(v_src, v_old, v_new);

  -- Needle B: the condition itself, now delegated to the pure predicate.
  v_old := $n$    if r_rec.recent_ms is not null
       and r_rec.recent_ms > greatest(5 * r_rec.p50_ms, 60000) then$n$;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'needle B (LIMB 5 condition) not found exactly once - re-derive this migration from the LIVE body';
  end if;
  v_new := $n$    if public.mon_detector_cost_step_is_sustained(r_rec.p50_ms, r_rec.recent_desc) then$n$;
  v_src := replace(v_src, v_old, v_new);

  -- Needle C: the payload. It must publish BOTH numbers -- the sustained cost that decided the
  -- raise and the peak -- because a responder's first question is which of the two shapes this is,
  -- and the old payload asserted the answer instead of showing the evidence for it.
  v_old := $n$          'baseline_p50_ms', round(r_rec.p50_ms),
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
             ||'Do NOT silence this by removing the detector from the roster.'))$n$;
  if (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'needle C (LIMB 5 payload) not found exactly once - re-derive this migration from the LIVE body';
  end if;
  v_new := $n$          'baseline_p50_ms', round(r_rec.p50_ms),
          'sustained_ms', round(r_rec.recent_ms),
          'peak_ms', round(r_rec.peak_ms),
          'last_3_sweeps_ms', (select jsonb_agg(round(x)) from unnest(r_rec.recent_desc) x),
          'recent_max_ms', round(r_rec.peak_ms),
          'ratio', round(r_rec.recent_ms / greatest(r_rec.p50_ms, 1), 1),
          'peak_ratio', round(r_rec.peak_ms / greatest(r_rec.p50_ms, 1), 1),
          'why','this detector has cost many times its own baseline in at least TWO of the last '
             ||'three sweeps, so the cost has STEPPED rather than spiked. sustained_ms (the '
             ||'second-highest of the last three) is what decided this; peak_ms is the worst one. '
             ||'The sweep runs in ONE transaction under a statement_timeout, so a detector that '
             ||'grows without bound does not just slow things down -- it can take the whole sweep '
             ||'past the ceiling, rolling back every alert already raised and skipping dispatch. '
             ||'It also holds a pg_cron worker for its whole runtime, which is how 13 unrelated '
             ||'jobs lost scheduled runs on 2026-09-15.',
          'action','root-cause the detector''s own query. Its cost usually tracks a DATA change '
             ||'upstream (on 2026-09-15 a numbered district value made a district-split CTE 50x '
             ||'more expensive), so look at what its inputs did before rewriting the detector. '
             ||'Do NOT silence this by removing the detector from the roster.',
          'not_this','a ONE-sweep spike is deliberately NOT reported here and must not be made to '
             ||'be: 70 of this limb''s first 71 alerts were single-sweep lock waits, and while one '
             ||'sat open mon_raise() dedup meant a real regression in the same detector raised '
             ||'nothing (routine-2-production, 2026-09-26). If a single sweep ran long, that is a '
             ||'SWEEP fact, not a detector fact -- LIMB 1/3/4 and mon_detect_cron_starvation_risk() '
             ||'own it. Check for concurrent DDL on whatever this detector reads before suspecting '
             ||'its query.'))$n$;
  v_src := replace(v_src, v_old, v_new);

  execute v_src;
end $mig$;

-- ---------------------------------------------------------------------------------------------
-- PART 3 - EXECUTED proof, at apply time. Both directions, on real production series.
-- ---------------------------------------------------------------------------------------------
do $proof$
declare
  v_bad text := '';
begin
  -- (1) THE REAL TRANSIENT, SUPPRESSED. mon_detect_phasea_offregion_pick, 2026-09-26 sweeps
  --     04:59 / 05:31 / 05:59, p50 11,903 ms. One elevated value, bracketed by baseline.
  if public.mon_detector_cost_step_is_sustained(11903, array[65845, 12686, 12599]::numeric[]) then
    v_bad := v_bad || ' [1 isolated spike must NOT raise]';
  end if;

  -- (2) THE REAL REGRESSION, KEPT. mon_detect_card_label_contract, 2026-09-15 11:29,
  --     p50 10,214 ms, elevated on every sweep. This is alert 3146, the one true positive.
  if not public.mon_detector_cost_step_is_sustained(10214, array[466338, 460308, 459997]::numeric[]) then
    v_bad := v_bad || ' [2 sustained regression must raise]';
  end if;

  -- (3) The 60s ABSOLUTE FLOOR survives: a cheap detector going 8ms -> 60ms is 7.5x and costs
  --     nothing. mon_detect_rent_period_inferred_when_source_silent really did run 7.43x today
  --     (4,932 -> 36,647 ms) and correctly did not raise, because it never crossed 60s.
  if public.mon_detector_cost_step_is_sustained(8, array[60, 60, 60]::numeric[]) then
    v_bad := v_bad || ' [3 the 60s floor must survive]';
  end if;
  if public.mon_detector_cost_step_is_sustained(4932, array[36647, 36647, 4900]::numeric[]) then
    v_bad := v_bad || ' [3b under the 60s floor must NOT raise]';
  end if;

  -- (4) The 5x RATIO survives: an expensive-but-steady detector must not raise merely for being
  --     expensive. 60s p50 sustained at 100s is only 1.7x.
  if public.mon_detector_cost_step_is_sustained(60000, array[100000, 100000, 100000]::numeric[]) then
    v_bad := v_bad || ' [4 the 5x ratio must survive]';
  end if;

  -- (5) TWO of three is the bar, in both directions, at the same magnitude.
  if not public.mon_detector_cost_step_is_sustained(11903, array[65845, 65000, 12599]::numeric[]) then
    v_bad := v_bad || ' [5 two of three must raise]';
  end if;

  -- (6) ABSTAIN, never raise, when persistence is unprovable (fewer than 2 real runs).
  if public.mon_detector_cost_step_is_sustained(11903, array[65845]::numeric[]) then
    v_bad := v_bad || ' [6 a single sample must NOT raise]';
  end if;
  if public.mon_detector_cost_step_is_sustained(11903, null) then
    v_bad := v_bad || ' [6b a null series must NOT raise]';
  end if;

  -- (7) A NULL baseline must not become a free pass: the 60s floor still governs.
  if not public.mon_detector_cost_step_is_sustained(null, array[61000, 61000, 61000]::numeric[]) then
    v_bad := v_bad || ' [7 a null p50 still honours the 60s floor]';
  end if;

  if v_bad <> '' then
    raise exception 'mon_detector_cost_step_is_sustained() proof FAILED:%', v_bad;
  end if;
  raise notice 'mon_detector_cost_step_is_sustained(): 9 executed cases pass, both directions.';
end $proof$;