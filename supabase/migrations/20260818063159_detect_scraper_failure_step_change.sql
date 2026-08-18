-- MONITORING GAP with a two-day proven miss. wasalt went from 0% run failures for seven straight
-- days to 60.2% (2026-08-17) and 64.7% (2026-08-18) — "FETCHED 0 ROWS — proxy/network block" on
-- 67 of 103 runs — and NOTHING alerted for two days. mon_detect_silent_scraper_death cannot see it:
-- the platform still has successful runs and still upserts rows, so it is not "silent death", it is
-- partial capture loss. Senior run #25 diagnosed this on 2026-08-17 and deliberately did NOT ship a
-- detector, because a FIXED threshold could not be calibrated honestly from one day of data:
-- aqar_residential's per-burst failure rate spans a continuous 9-56% as its NORMAL texture, so any
-- global ">=50% of runs failed" rule would have fired on a healthy platform the same day.
--
-- The calibration data now exists, and it says the right signal is the STEP CHANGE against the
-- platform's own history, not any absolute rate. Measured over 14 days (daily failure %):
--
--   platform           median   worst prior day   today
--   wasalt               0.0        60.2           64.7   <- must fire
--   aqar_residential     3.5         7.0            3.4   <- must stay silent (normal texture)
--   aqar_commercial      0.0         8.3            0.0   <- must stay silent
--   aqarmonthly          0.0         0.0            0.0
--   gathern              0.0         0.0            0.0
--   aqaratikom           0.0        50.0            0.0   <- 1-2 runs/day: ONE failure reads as 50%
--   dealapp              0.0       100.0            —     <- 12 runs/day, same artefact
--
-- Hence three conditions, each earning its place:
--   * a MIN RUN FLOOR (>=20 runs in the window). Without it, the low-volume platforms above fire on
--     a single ordinary failure — 1 of 2 runs is "50%", which is noise, not a step change.
--   * a MARGIN over the platform's own 14-day median (+25 points), not a global threshold. This is
--     what keeps aqar_residential quiet at its normal 3-7% while catching wasalt's 0 -> 65.
--   * an ABSOLUTE FLOOR (>=20%), so a platform with a pristine 0% history cannot be alarmed by a
--     handful of failures.
--
-- Baseline deliberately EXCLUDES the current window, or a sustained outage would slowly redefine
-- itself as normal and the alert would resolve while the platform was still broken.

create or replace function public.mon_detect_scraper_failure_step_change()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; live text[] := '{}'; r record;
  min_runs   constant int := 20;   -- volume floor: below this, one failure is not a rate
  margin_pts constant numeric := 25;
  abs_floor  constant numeric := 20;
begin
  for r in
    with cur as (
      select platform,
             count(*) as runs,
             count(*) filter (where ok is false) as failed,
             round(100.0 * count(*) filter (where ok is false) / nullif(count(*),0), 1) as pct
        from public.scrape_runs
       where started_at >= now() - interval '24 hours'
       group by platform
      having count(*) >= min_runs
    ), base as (
      select platform,
             round((percentile_cont(0.5) within group (
               order by 100.0 * failed_d / nullif(runs_d,0)))::numeric, 1) as median_pct,
             count(*) as days
        from (
          select platform,
                 date_trunc('day', started_at) as d,
                 count(*) as runs_d,
                 count(*) filter (where ok is false) as failed_d
            from public.scrape_runs
           where started_at >= now() - interval '15 days'
             and started_at <  now() - interval '24 hours'   -- never let the outage rewrite normal
           group by 1,2
        ) z
       group by platform
    )
    select c.platform, c.runs, c.failed, c.pct, b.median_pct, b.days
      from cur c join base b using (platform)
     where b.days >= 5                                    -- need real history to call it a change
       and c.pct >= b.median_pct + margin_pts
       and c.pct >= abs_floor
     order by c.pct desc
  loop
    live := live || ('scraper_failure_step_change:' || r.platform);
    n := n + public.mon_raise('P1', 'scraper_failure_step_change', r.platform,
      'scraper_failure_step_change:' || r.platform,
      jsonb_build_object(
        'runs_24h', r.runs, 'failed_24h', r.failed, 'failure_pct', r.pct,
        'baseline_median_pct', r.median_pct, 'baseline_days', r.days,
        'why', 'this platform''s run-failure rate stepped far above its OWN 14-day baseline. The '
            || 'scrapers are not silently dead — they still succeed and still upsert — so '
            || 'mon_detect_silent_scraper_death cannot see this. Partial capture loss degrades '
            || 'freshness and enrichment while every count-based check stays green.',
        'adjudicate', 'Check the failing runs'' notes. "FETCHED 0 ROWS — proxy/network block" with '
            || 'IDENTICAL burst sizes to a healthy prior day is SOURCE/PROXY-side, not an Ezhalah '
            || 'regression — do not "fix" a scraper that did not change. Confirm liveness ran on an '
            || 'independent transport before trusting any inactivation from this window.'));
  end loop;

  perform public.mon_resolve_stale_keys('scraper_failure_step_change', live);
  return n;
end $function$;

comment on function public.mon_detect_scraper_failure_step_change() is
  'Barrier (senior run #28, 2026-08-18): catches PARTIAL scraper capture loss — a platform whose run-'
  'failure rate steps above its own 14-day median while it still succeeds often enough to look alive. '
  'Closes the gap that let wasalt run at 60-65% failures for two days with zero alerting. Per-platform '
  'baseline + volume floor, deliberately not a global threshold (that would fire on aqar_residential).';

-- Roster wiring via the guarded pg_get_functiondef NEEDLE-EDIT — never a wholesale
-- create-or-replace of the roster (that mistake was caught by CI on PR #722, run #25).
do $$
declare
  v_def text; v_before text;
  fn constant text := 'mon_detect_scraper_failure_step_change';
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;
  if position(anchor in v_def) = 0 then raise exception 'roster anchor missing'; end if;
  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;
  if v_def <> v_before then execute v_def; end if;
end $$;

-- Prove the roster kept everything it had, and BOTH DIRECTIONS of the predicate.
do $$
declare v_def text; v int; v_hits text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if position('''mon_detect_scraper_failure_step_change''' in v_def) = 0 then
    raise exception 'detector not reachable from the roster';
  end if;
  -- roster must not have lost pre-existing content
  if position('''mon_detect_orphaned_detectors''' in v_def) = 0
     or position('''mon_detect_district_bridge_leak''' in v_def) = 0
     or position('''mon_detect_summary_only_capture''' in v_def) = 0
     or position('open_alerts' in v_def) = 0 then
    raise exception 'roster lost pre-existing content';
  end if;

  -- POSITIVE: wasalt is in a proven step change right now, so the detector must name it.
  select public.mon_detect_scraper_failure_step_change() into v;
  select string_agg(dedup_key, ', ') into v_hits from public.alert_event
   where kind = 'scraper_failure_step_change' and resolved_at is null;
  if v_hits is null or position('wasalt' in v_hits) = 0 then
    raise exception 'detector did not catch the proven wasalt step change (open keys: %)', coalesce(v_hits,'none');
  end if;

  -- NEGATIVE: it must NOT have fired on aqar_residential, which is inside its normal texture.
  if position('aqar_residential' in v_hits) > 0 then
    raise exception 'false positive on aqar_residential — margin/floor mis-calibrated (keys: %)', v_hits;
  end if;
end $$;
