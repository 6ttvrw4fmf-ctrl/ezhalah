-- 🔧 2026-11-03 — TWO BARRIERS DISAGREED ON «STUCK BEFORE SEARCH» FOR A PERIOD-SILENT PLATFORM (alert 12873).
--
-- 20261103132306 (this morning, alert 12844 alsaedan) made verdict 3 of mon_searchability_verdict() need evidence that
-- rows are STUCK — a measurable period axis or a row blocked from production — because on a platform whose source
-- publishes no rent period searchable_by_period is 0 by construction, so growth alone read as rows stuck before search
-- while every row was production_ready and reachable (owner rule 2026-09-05: an honest unknown period is not a
-- searchability failure). mon_detect_searchability_verdict_ordering() (2026-09-15) still carried the opposite
-- expectation in ONE case: period-silent, held tripled, nothing blocked → NEW_ROWS_STUCK_BEFORE_SEARCH. It raised P1
-- 12873 at the 13:59 sweep. The 09-15 proof's point — the platform-health verdicts must stay REACHABLE for a
-- period-silent platform, the waiver must stay LAST — is kept whole: the same case now carries the evidence (10 of
-- 60 rows blocked, under verdict 4's 20 % line) and must still say STUCK, the PRODUCTION_READY_FELL case is untouched,
-- and alsaedan's own numbers (growth alone, nothing blocked) are pinned as OK_NO_SOURCE_ESTABLISHED_PERIOD so the two
-- barriers can never drift apart again.
do $mig$
declare d text; old_ text; new_ text;
begin
  d := pg_get_functiondef('public.mon_detect_searchability_verdict_ordering'::regproc);
  old_ := E'  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 60, 20, 0, 0);\n'
       || E'  if v is distinct from ''NEW_ROWS_STUCK_BEFORE_SEARCH'' then\n'
       || E'    failures := failures || jsonb_build_object(\n'
       || E'      ''case'', ''period_silent_new_rows_stuck'',\n'
       || E'      ''expected'', ''NEW_ROWS_STUCK_BEFORE_SEARCH'', ''got'', v);\n'
       || E'  end if;\n';
  if position(old_ in d) = 0 then raise exception 'anchor (period_silent_new_rows_stuck case) not found'; end if;
  new_ := E'  -- Stuck needs evidence (20261103132306): period-silent, held tripled, 10 of 60 rows blocked from production.\n'
       || E'  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 60, 20, 0, 10);\n'
       || E'  if v is distinct from ''NEW_ROWS_STUCK_BEFORE_SEARCH'' then\n'
       || E'    failures := failures || jsonb_build_object(\n'
       || E'      ''case'', ''period_silent_new_rows_stuck'',\n'
       || E'      ''expected'', ''NEW_ROWS_STUCK_BEFORE_SEARCH'', ''got'', v);\n'
       || E'  end if;\n'
       || E'\n'
       || E'  -- Growth alone on a period-silent platform is NOT stuck (alsaedan 2026-11-03: 129 held vs 100, all production_ready).\n'
       || E'  v := public.mon_searchability_verdict(NULL, false, 13, NULL, 129, 100, 0, 0);\n'
       || E'  if v is distinct from ''OK_NO_SOURCE_ESTABLISHED_PERIOD'' then\n'
       || E'    failures := failures || jsonb_build_object(\n'
       || E'      ''case'', ''period_silent_growth_alone_is_not_stuck'',\n'
       || E'      ''expected'', ''OK_NO_SOURCE_ESTABLISHED_PERIOD'', ''got'', v);\n'
       || E'  end if;\n';
  d := replace(d, old_, new_);
  execute d;
  d := pg_get_functiondef('public.mon_detect_searchability_verdict_ordering'::regproc);
  if position('period_silent_growth_alone_is_not_stuck' in d) = 0 or position('NULL, 60, 20, 0, 10)' in d) = 0 then
    raise exception 'the reconciled cases did not land';
  end if;
  -- PROOF: the reachability cases the 09-15 proof exists for still hold on the live predicate.
  if public.mon_searchability_verdict(NULL, false, 13, NULL, 60, 60, 0, 30) is distinct from 'PRODUCTION_READY_FELL' then raise exception 'PROOF: PRODUCTION_READY_FELL unreachable for a period-silent platform'; end if;
  if public.mon_searchability_verdict(NULL, false, 13, NULL, 60, 20, 0, 10) is distinct from 'NEW_ROWS_STUCK_BEFORE_SEARCH' then raise exception 'PROOF: stuck with blocked evidence unreachable'; end if;
  if public.mon_searchability_verdict(NULL, false, 13, NULL, 129, 100, 0, 0) is distinct from 'OK_NO_SOURCE_ESTABLISHED_PERIOD' then raise exception 'PROOF: alsaedan growth alone must be OK'; end if;
end $mig$;

-- The detector re-judges now and resolves searchability_verdict_ordering when every case holds.
select public.mon_detect_searchability_verdict_ordering();