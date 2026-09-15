-- Data Integrity (routine #3), 2026-09-15.
--
-- THE DEFECT. mon_searchability_alerts decided its verdict with this CASE, first branch first:
--
--     WHEN n.pct_period_searchable IS NULL THEN 'OK_NO_SOURCE_ESTABLISHED_PERIOD'
--     WHEN ... THEN 'SEARCHABILITY_COLLAPSE'
--     WHEN ... THEN 'SEARCHABILITY_DROP'
--     WHEN ... THEN 'NEW_ROWS_STUCK_BEFORE_SEARCH'
--     WHEN ... THEN 'PRODUCTION_READY_FELL'
--     ELSE 'OK'
--
-- pct_period_searchable IS NULL is exactly period_known = 0 (the ratio NULLIFs its own denominator).
-- The branch is correct in intent and correctly scoped in the DETECTOR'S COMMENT — "nothing to
-- measure, because the source established no period for any listing here" is a statement about the
-- PERIOD dimension, and it is right: under the owner rule of 2026-09-03/09-05 an honest unknown
-- period is not a searchability failure, and mon_detect_searchability_collapse treats every verdict
-- matching 'OK%' as healthy.
--
-- But the branch is placed FIRST, so it does not silence the period verdicts only — it silences the
-- whole row. NEW_ROWS_STUCK_BEFORE_SEARCH and PRODUCTION_READY_FELL have nothing to do with the
-- rental period: they detect rows piling up without reaching search, and production_ready
-- collapsing. For any platform whose source publishes no period at all, BOTH were unreachable —
-- the detector could not fire no matter how badly those two failed.
--
-- MEASURED TODAY: 9 of 35 rent-apartment platforms sit in that branch and were exempt from both
-- verdicts — alkhaas, aouj, arkaan, hajer, mizlaj, raghdan, remal, sadin (+ any future
-- period-silent platform). arkaan (49 held) and raghdan (51 held) are already over the held >= 20
-- floor those verdicts require, so the exemption was live, not theoretical. This is the repo's own
-- recurring shape: a monitor that cannot fire reads as a clean bill of health.
--
-- THE FIX. The period waiver stops pre-empting the platform-health verdicts: it now runs AFTER
-- them, so it silences only what it is entitled to silence. Relative precedence among the four
-- alerting verdicts is unchanged, and no previously-alerting state becomes silent — the change is
-- strictly MORE sensitive, never less.
--
-- The predicate is lifted out of the view into ONE pure function so it can be EXECUTED against
-- synthetic inputs rather than read as text. Every barrier this repo has been burned by was a
-- source-TEXT tripwire that passed while the defect was live (AGENTS.md, 2026-09-04); the proofs at
-- the bottom of this migration run the real function and fail the migration if either direction is
-- wrong.

create or replace function public.mon_searchability_verdict(
  p_pct_period_searchable        numeric,
  p_period_waived                boolean,
  p_baseline_samples             bigint,
  p_baseline_pct                 numeric,
  p_held                         bigint,
  p_baseline_held                numeric,
  p_searchable_by_period         bigint,
  p_blocked_not_production_ready bigint
) returns text
language sql
immutable
as $fn$
  select case
    -- 1-2. PERIOD verdicts. Both need a measurable ratio, so both are already unreachable when the
    --      source established no period for any row: they cannot fire on an honest unknown.
    when not p_period_waived and coalesce(p_baseline_samples, 0) >= 3 and p_baseline_pct >= 50
         and p_pct_period_searchable < (p_baseline_pct * 0.5)
      then 'SEARCHABILITY_COLLAPSE'
    when not p_period_waived and coalesce(p_baseline_samples, 0) >= 3 and p_baseline_pct >= 50
         and p_pct_period_searchable < (p_baseline_pct - 15)
      then 'SEARCHABILITY_DROP'
    -- 3-4. PLATFORM-HEALTH verdicts. Independent of the rental period, so the period waiver below
    --      must never pre-empt them. This ordering IS the fix.
    when coalesce(p_baseline_samples, 0) >= 3 and p_held >= 20
         and p_held::numeric > (p_baseline_held * 1.20)
         and p_searchable_by_period::numeric <= p_baseline_held
      then 'NEW_ROWS_STUCK_BEFORE_SEARCH'
    when p_held >= 20
         and p_blocked_not_production_ready::numeric >= (p_held::numeric * 0.20)
      then 'PRODUCTION_READY_FELL'
    -- 5. The period waiver, now last: nothing to measure on the period axis, and the platform-health
    --    axis has already had its say.
    when p_pct_period_searchable is null
      then 'OK_NO_SOURCE_ESTABLISHED_PERIOD'
    else 'OK'
  end
$fn$;

comment on function public.mon_searchability_verdict(numeric, boolean, bigint, numeric, bigint, numeric, bigint, bigint) is
  'The ONE searchability verdict predicate, shared by mon_searchability_alerts and therefore by '
  'mon_detect_searchability_collapse. Pure and immutable so it can be executed against synthetic '
  'inputs. Ordering matters: the OK_NO_SOURCE_ESTABLISHED_PERIOD waiver runs LAST so it silences '
  'only the period verdicts, never NEW_ROWS_STUCK_BEFORE_SEARCH or PRODUCTION_READY_FELL. It sat '
  'first until 2026-09-15, which exempted every period-silent platform from both.';

create or replace view public.mon_searchability_alerts as
 WITH now_ AS (
         SELECT mon_searchability_now.platform,
            mon_searchability_now.held,
            mon_searchability_now.searchable_annual,
            mon_searchability_now.pct_annual_searchable,
            mon_searchability_now.monthly_by_source,
            mon_searchability_now.period_unknown,
            mon_searchability_now.correctly_withheld_no_source_data,
            mon_searchability_now.suspect_price_without_period,
            mon_searchability_now.blocked_not_production_ready,
            mon_searchability_now.new_last_48h,
            mon_searchability_now.searchable_by_period,
            mon_searchability_now.pct_period_searchable,
            mon_searchability_now.period_waived,
            mon_searchability_now.source_limited_excluded,
            mon_searchability_now.period_known
           FROM mon_searchability_now
        ), base AS (
         SELECT h.platform,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY ((100.0 * h.searchable_by_period::numeric / NULLIF(h.held - h.period_unknown, 0)::numeric)::double precision))::numeric AS baseline_pct,
            percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (h.held::double precision))::numeric AS baseline_held,
            count(*) AS samples
           FROM mon_searchability_history h
          WHERE h.captured_at > (now() - '14 days'::interval) AND h.captured_at < date_trunc('day'::text, now())
          GROUP BY h.platform
        )
 SELECT n.platform,
    n.held,
    n.searchable_by_period,
    n.pct_period_searchable,
    round(b.baseline_pct, 1) AS baseline_pct,
    round(b.baseline_held, 0) AS baseline_held,
    COALESCE(b.samples, 0::bigint) AS baseline_samples,
    n.period_waived,
    n.suspect_price_without_period,
    n.correctly_withheld_no_source_data,
    n.blocked_not_production_ready,
    public.mon_searchability_verdict(
      n.pct_period_searchable, n.period_waived, COALESCE(b.samples, 0::bigint), b.baseline_pct,
      n.held, b.baseline_held, n.searchable_by_period, n.blocked_not_production_ready) AS verdict,
    n.period_known,
    n.period_unknown
   FROM now_ n
     LEFT JOIN base b ON b.platform = n.platform;

-- ---------------------------------------------------------------------------------------------
-- MUTATION PROOFS. These EXECUTE the real function. If the ordering regresses, the migration fails.
-- ---------------------------------------------------------------------------------------------
DO $proof$
DECLARE v text;
BEGIN
  -- A. THE DEFECT ITSELF. Period-silent platform (pct NULL) whose production_ready collapsed:
  --    60 held, 30 blocked (50% >= the 20% floor). The old ordering returned the OK waiver.
  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 60, 60, 0, 30);
  IF v <> 'PRODUCTION_READY_FELL' THEN
    RAISE EXCEPTION 'PROOF A FAILED: period-silent platform with 50%% blocked returned %, expected PRODUCTION_READY_FELL', v;
  END IF;

  -- B. THE OTHER SWALLOWED VERDICT. Period-silent platform whose new rows are stuck before search:
  --    held 60 vs baseline 20 (>20% growth), searchable_by_period 0 <= baseline.
  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 60, 20, 0, 0);
  IF v <> 'NEW_ROWS_STUCK_BEFORE_SEARCH' THEN
    RAISE EXCEPTION 'PROOF B FAILED: period-silent platform with rows stuck returned %, expected NEW_ROWS_STUCK_BEFORE_SEARCH', v;
  END IF;

  -- C. THE WAIVER STILL WAIVES. Period-silent and genuinely healthy -> still silent. This is the
  --    half that must NOT regress: an honest unknown period is not a searchability failure.
  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 51, 55, 0, 0);
  IF v <> 'OK_NO_SOURCE_ESTABLISHED_PERIOD' THEN
    RAISE EXCEPTION 'PROOF C FAILED: healthy period-silent platform returned %, expected OK_NO_SOURCE_ESTABLISHED_PERIOD', v;
  END IF;

  -- D. Small period-silent platform stays under the held >= 20 floor -> still waived.
  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 10, 10, 0, 10);
  IF v <> 'OK_NO_SOURCE_ESTABLISHED_PERIOD' THEN
    RAISE EXCEPTION 'PROOF D FAILED: 10-row period-silent platform returned %, expected OK_NO_SOURCE_ESTABLISHED_PERIOD', v;
  END IF;

  -- E-F. The period verdicts are untouched and still outrank everything.
  v := public.mon_searchability_verdict(20, false, 13, 100, 60, 60, 12, 0);
  IF v <> 'SEARCHABILITY_COLLAPSE' THEN
    RAISE EXCEPTION 'PROOF E FAILED: returned %, expected SEARCHABILITY_COLLAPSE', v;
  END IF;
  v := public.mon_searchability_verdict(80, false, 13, 100, 60, 60, 48, 0);
  IF v <> 'SEARCHABILITY_DROP' THEN
    RAISE EXCEPTION 'PROOF F FAILED: returned %, expected SEARCHABILITY_DROP', v;
  END IF;

  -- G. A waived platform is still exempt from the period verdicts.
  v := public.mon_searchability_verdict(20, true, 13, 100, 10, 10, 2, 0);
  IF v <> 'OK' THEN
    RAISE EXCEPTION 'PROOF G FAILED: waived platform returned %, expected OK', v;
  END IF;

  -- H. Fully healthy.
  v := public.mon_searchability_verdict(100, false, 13, 100, 60, 60, 60, 0);
  IF v <> 'OK' THEN
    RAISE EXCEPTION 'PROOF H FAILED: healthy platform returned %, expected OK', v;
  END IF;

  RAISE NOTICE 'all 8 verdict proofs passed';
END
$proof$;

-- ---------------------------------------------------------------------------------------------
-- ZERO LIVE CHURN. The new ordering must not flip any platform's verdict TODAY: this fix opens a
-- path for two verdicts to fire, it does not itself raise anything. Compare the new view against
-- the OLD inline CASE over live data and refuse to install if any platform moved.
-- ---------------------------------------------------------------------------------------------
DO $churn$
DECLARE moved int;
BEGIN
  WITH now_ AS (SELECT * FROM public.mon_searchability_now),
  base AS (
    SELECT h.platform,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ((100.0 * h.searchable_by_period::numeric / NULLIF(h.held - h.period_unknown, 0)::numeric)::double precision))::numeric AS baseline_pct,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY (h.held::double precision))::numeric AS baseline_held,
      count(*) AS samples
    FROM public.mon_searchability_history h
    WHERE h.captured_at > (now() - '14 days'::interval) AND h.captured_at < date_trunc('day', now())
    GROUP BY h.platform)
  SELECT count(*) INTO moved
  FROM now_ n
  LEFT JOIN base b ON b.platform = n.platform
  JOIN public.mon_searchability_alerts a ON a.platform = n.platform
  WHERE a.verdict IS DISTINCT FROM (CASE
      WHEN n.pct_period_searchable IS NULL THEN 'OK_NO_SOURCE_ESTABLISHED_PERIOD'
      WHEN NOT n.period_waived AND COALESCE(b.samples,0) >= 3 AND b.baseline_pct >= 50 AND n.pct_period_searchable < (b.baseline_pct * 0.5) THEN 'SEARCHABILITY_COLLAPSE'
      WHEN NOT n.period_waived AND COALESCE(b.samples,0) >= 3 AND b.baseline_pct >= 50 AND n.pct_period_searchable < (b.baseline_pct - 15) THEN 'SEARCHABILITY_DROP'
      WHEN COALESCE(b.samples,0) >= 3 AND n.held >= 20 AND n.held::numeric > (b.baseline_held * 1.20) AND n.searchable_by_period::numeric <= b.baseline_held THEN 'NEW_ROWS_STUCK_BEFORE_SEARCH'
      WHEN n.held >= 20 AND n.blocked_not_production_ready::numeric >= (n.held::numeric * 0.20) THEN 'PRODUCTION_READY_FELL'
      ELSE 'OK' END);

  IF moved <> 0 THEN
    RAISE EXCEPTION 'CHURN CHECK FAILED: % platform(s) changed verdict today; this fix must open a path, not raise an alarm by itself', moved;
  END IF;
  RAISE NOTICE 'zero live churn confirmed across all platforms';
END
$churn$;