-- REGRESSION PROTECTION for the defect fixed on 2026-09-04: a single full-inventory detector
-- (mon_detect_v2_discards_captured_attrs, avg 50.9s / max 209.8s, 48 runs a day) grew until it
-- consumed ~39 minutes of sweep budget daily, tripped the sweep's soft deadline and left 26
-- detectors unmeasured for a half hour.
--
-- Nothing in the system asked the question "is any detector too expensive to run every 30
-- minutes?". mon_detect_detector_sweep_budget watches the TOTAL, so it fires only once the sweep
-- is already at the cliff, and it names no culprit -- an engineer has to attribute it by hand,
-- which is how this went unattributed while ops_detector_timing held the answer the whole time.
-- This detector asks the per-detector question directly, and names the detector.
--
-- The escape hatch is the one the repo already sanctions: mon_claim_daily_slot() (~20h), whose
-- entries live in ops_detector_last_full_run. A gated detector is exempt here BY DESIGN, because
-- gating is what makes an expensive structural scan affordable -- and a gated detector that stops
-- running is separately caught by mon_detect_stalled_daily_detector (30h). So the two states this
-- barrier permits are "cheap enough to run every sweep" and "gated and watched"; the state it
-- refuses is "expensive AND ungated AND unmeasured".
--
-- Note ops_detector_last_full_run stores slot names in BOTH conventions -- bare
-- ('price_size_contamination') and prefixed ('mon_detect_card_link_identity') -- so the exemption
-- must match either, or a genuinely gated detector is reported as ungated.
--
-- KNOWN AND INTENDED first firing: mon_detect_discarded_location_resolution (p90 87.9s, max
-- 690.9s over 7 days, ungated). That is the detector both 2026-09-04 sweep aborts (06:29Z,
-- 06:59Z) died inside, and 690.9s is 77% of the entire 900s budget in ONE detector. It is NOT
-- gated by this run because its limb B deliberately carries a 75-minute grace tied to the hourly
-- sync job, so a 20h gate would convert a ~75-minute detection latency into a 20-hour one for a
-- P1 search-reachability condition. The correct fix there is to make
-- mon_discarded_location_candidates cheaper, not to see it less often -- this barrier exists to
-- keep that visible and attributed instead of silent.

create or replace function public.mon_detect_ungated_expensive_detector()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  r record;
  live text[] := '{}';
  c_p90_ceiling_ms constant numeric := 45000;   -- 48 sweeps/day * 45s = ~36 min/day of budget
  c_min_runs       constant int     := 20;      -- ignore a detector with too little history
begin
  for r in
    select t.detector,
           percentile_disc(0.9) within group (order by t.elapsed_ms) as p90_ms,
           max(t.elapsed_ms) as max_ms,
           count(*) as runs
      from public.ops_detector_timing t
     where t.swept_at > now() - interval '7 days'
       and not t.skipped
       and coalesce(t.crashed, false) = false
       and not exists (select 1 from public.ops_detector_last_full_run g
                        where g.detector = t.detector
                           or 'mon_detect_' || g.detector = t.detector)
     group by t.detector
    having count(*) >= c_min_runs
       and percentile_disc(0.9) within group (order by t.elapsed_ms) > c_p90_ceiling_ms
     order by 2 desc
  loop
    live := live || ('ungated_expensive_detector:' || r.detector);
    n := n + public.mon_raise('P2', 'ungated_expensive_detector', 'monitoring',
      'ungated_expensive_detector:' || r.detector,
      jsonb_build_object(
        'detector', r.detector,
        'p90_s', round(r.p90_ms / 1000.0, 1),
        'max_s', round(r.max_ms / 1000.0, 1),
        'runs_7d', r.runs,
        'p90_ceiling_s', round(c_p90_ceiling_ms / 1000.0, 1),
        'why', 'This detector runs on EVERY half-hourly sweep and its p90 alone is a large '
            || 'fraction of the sweep budget. pg_cron runs the whole sweep in one transaction, '
            || 'so when the budget runs out nothing is skipped gracefully -- every alert the '
            || 'sweep already raised is rolled back, mon_dispatch_alerts never runs, and even '
            || 'the ops_detector_timing rows that would explain it are rolled back. Read max_s, '
            || 'not just p90_s: the tail is what kills the sweep.',
        'action', 'Either make the detector cheaper, or give it the sanctioned gate: add '
            || 'if not public.mon_claim_daily_slot(''<name>'') then return 0; end if; as its '
            || 'first statement. Gate only if the condition genuinely changes at most daily -- '
            || 'a detector with a short grace window tied to a frequent job (e.g. an hourly '
            || 'sync) loses real detection latency when gated, and should be optimised instead.',
        'do_not', 'Do NOT widen the sweep statement_timeout to make this go away, and do NOT '
            || 'remove the detector from the roster. Both trade a named, bounded cost for an '
            || 'unmeasured one.'));
  end loop;

  perform public.mon_resolve_stale_keys('ungated_expensive_detector', live);
  return n;
end
$function$;

-- Roster entry, in the SAME migration as the detector (AGENTS.md): a detector nothing reaches is
-- decoration, and mon_detect_orphaned_detectors() fires on exactly that. Added by string surgery
-- with an anchor assertion so the existing roster is preserved byte-for-byte.
do $mig$
declare
  v_def text;
  a_tail constant text := '''mon_detect_liveness_verification_sla''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if v_def is null then raise exception 'mon_run_all_detectors() not found'; end if;
  if position('mon_detect_ungated_expensive_detector' in v_def) > 0 then
    raise notice 'roster already carries the detector -- nothing to do';
    return;
  end if;
  if position(a_tail in v_def) = 0 then raise exception 'anchor missing: roster tail'; end if;

  execute replace(v_def, a_tail, a_tail || ', ''mon_detect_ungated_expensive_detector''');
end
$mig$;
