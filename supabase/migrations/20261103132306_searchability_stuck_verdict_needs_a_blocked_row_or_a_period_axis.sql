-- A PERIOD-SILENT PLATFORM THAT MERELY GREW IS NOT «STUCK BEFORE SEARCH» (🔧 2026-11-03, alert 12844 alsaedan).
-- mon_searchability_verdict() verdict 3 (NEW_ROWS_STUCK_BEFORE_SEARCH) fires when the held rent apartments grew more
-- than 20 % over the 14-day median while searchable_by_period did not grow. On a platform whose source publishes NO
-- rent period (alsaedan: 342 active rows, rent_period NULL on every one, period_known 0) searchable_by_period is 0 by
-- definition, so ANY growth read as rows stuck before search: 31 arrivals on 11-03 took held to 129 against a baseline
-- near 100, blocked_not_production_ready 0 — every row production_ready and reachable with no period filter (owner
-- rule 2026-09-05, the detector's own «why» text). The verdict now needs evidence that rows are stuck: a measurable
-- period axis (pct_period_searchable not null) or at least one row blocked from production. Verdicts 1, 2 and 4 are
-- unchanged; the proofs below execute the live predicate at apply time.
create or replace function public.mon_searchability_verdict(
  p_pct_period_searchable numeric, p_period_waived boolean, p_baseline_samples bigint, p_baseline_pct numeric,
  p_held bigint, p_baseline_held numeric, p_searchable_by_period bigint, p_blocked_not_production_ready bigint)
returns text
language sql
immutable
as $function$
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
    --      Verdict 3 needs evidence that rows are STUCK, not merely more numerous: on a period-silent
    --      platform searchable_by_period is 0 by construction, so growth alone proved nothing
    --      (alsaedan 2026-11-03). A measurable period axis, or a row blocked from production, is that evidence.
    when coalesce(p_baseline_samples, 0) >= 3 and p_held >= 20
         and p_held::numeric > (p_baseline_held * 1.20)
         and p_searchable_by_period::numeric <= p_baseline_held
         and (p_pct_period_searchable is not null or coalesce(p_blocked_not_production_ready, 0) > 0)
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
$function$;

do $proof$
declare v text;
begin
  -- A. alsaedan's own numbers: period-silent, every row production_ready, held grew 29 % -> no alarm.
  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 129, 100, 0, 0);
  if v <> 'OK_NO_SOURCE_ESTABLISHED_PERIOD' then raise exception 'PROOF A FAILED: growth alone on a period-silent platform returned %', v; end if;
  -- B. period-silent, held tripled AND 10 of 60 rows blocked from production (under the 20 %% line of verdict 4) -> still stuck.
  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 60, 20, 0, 10);
  if v <> 'NEW_ROWS_STUCK_BEFORE_SEARCH' then raise exception 'PROOF B FAILED: blocked rows on a period-silent platform returned %', v; end if;
  -- C. a period-measurable platform whose held rows tripled while the period-searchable count did not -> stuck (unchanged).
  v := public.mon_searchability_verdict(80, false, 13, 80, 60, 20, 20, 0);
  if v <> 'NEW_ROWS_STUCK_BEFORE_SEARCH' then raise exception 'PROOF C FAILED: period-measurable stuck platform returned %', v; end if;
  -- D. a collapse still wins first (unchanged).
  v := public.mon_searchability_verdict(10, false, 13, 80, 60, 20, 5, 0);
  if v <> 'SEARCHABILITY_COLLAPSE' then raise exception 'PROOF D FAILED: collapse returned %', v; end if;
  -- E. no growth, 12 of 60 blocked -> PRODUCTION_READY_FELL (unchanged).
  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 60, 60, 0, 12);
  if v <> 'PRODUCTION_READY_FELL' then raise exception 'PROOF E FAILED: production_ready fall returned %', v; end if;
  -- F. the waiver still waives a healthy period-silent platform (unchanged).
  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 20, 20, 0, 0);
  if v <> 'OK_NO_SOURCE_ESTABLISHED_PERIOD' then raise exception 'PROOF F FAILED: healthy period-silent platform returned %', v; end if;
end
$proof$;

-- Live effect: the detector's own evaluated path closes searchability_collapse:alsaedan.
select public.mon_detect_searchability_collapse();
