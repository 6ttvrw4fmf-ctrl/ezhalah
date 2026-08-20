-- Senior Production Engineer run #32 (2026-08-20).
--
-- DEFECT. mon_detect_liveness_cap_degraded() reads the kill cap that a gathern liveness sweep
-- LOGGED (possibly ~22h ago) and compares it against a denominator it recomputes from the LIVE
-- active-row count at detection time. Those are two different moments, so ordinary inventory growth
-- alone drives expected above logged and raises a P2.
--
-- OBSERVED: alert 773 (P2, 2026-08-20 04:59) reported logged_cap=581 vs expected_cap=582. The run
-- (2026-08-19 06:46) had recorded its own arithmetic in its notes -- "[auto=max(150,2% of 29098)]"
-- -- and 2% of 29098 = 581.96 -> 581 is exactly right. Between run and detection the active count
-- grew 29,098 -> 29,119, which moved the recomputed expectation to 582. The cap was never degraded;
-- 21 new listings were.
--
-- This matters because the detector's whole purpose is the 2026-08-16 head=True class, where the
-- denominator collapsed to 0 and resolve_kill_cap(0) returned the 150 floor on every run for days.
-- A P2 that cries wolf on growth is the alert that will be scrolled past when that returns.
--
-- FIX -- made to DISCRIMINATE, not to go quiet. The detector now judges the run against the
-- denominator THE RUN ITSELF RECORDED, on two independent arms:
--   (a) ARITHMETIC: the logged cap must equal max(150, 2% of the denominator the run read. If the
--       run mis-derived its own cap, that is a real defect and still fires.
--   (b) COLLAPSE: the denominator the run read must not be far below the live active count (>= 90%).
--       This is the arm that catches head=True -- denominator 0 or 150-floor against a 29k inventory
--       -- and it is immune to ordinary growth, which moves the count by fractions of a percent.
-- If a run records no denominator at all, the old live comparison is kept as a fallback but with a
-- 5% tolerance so clock-drift alone cannot raise. An explicit [override ...] is still a reviewed
-- decision and still silences nothing else.

create or replace function public.mon_detect_liveness_cap_degraded()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  v_notes text;
  v_started timestamptz;
  v_logged int;
  v_active bigint;
  v_expected int;
  v_run_denom bigint;
  v_reason text := null;
begin
  select notes, started_at into v_notes, v_started
    from public.scrape_runs
   where platform = 'gathern_liveness' and notes ~ 'kill_cap=[0-9]+'
   order by started_at desc
   limit 1;

  if v_notes is null then
    perform public.mon_resolve_key('liveness_cap_degraded', 'liveness_cap_degraded:gathern');
    return 0;
  end if;

  if v_notes ~ '\[override' then
    perform public.mon_resolve_key('liveness_cap_degraded', 'liveness_cap_degraded:gathern');
    return 0;
  end if;

  v_logged := (regexp_match(v_notes, 'kill_cap=([0-9]+)'))[1]::int;
  select count(*) into v_active
    from public.gathern_residential_listings
   where active and source = 'Gathern';

  v_run_denom := (regexp_match(v_notes, 'auto=max\(150,\s*2% of ([0-9]+)\)'))[1]::bigint;

  if v_run_denom is not null then
    -- (a) did the run derive its cap correctly from the count it actually read?
    v_expected := greatest(150, (v_run_denom * 2 / 100)::int);
    if v_logged < v_expected then
      v_reason := format('the run read %s active rows but logged kill_cap=%s, below the max(150, 2%%) '
                      || 'its own denominator implies (%s) -- the cap derivation is broken',
                         v_run_denom, v_logged, v_expected);
    -- (b) was the count the run read itself collapsed? (the head=True class)
    elsif v_run_denom < (v_active * 0.9)::bigint then
      v_reason := format('the run computed its cap from a denominator of %s while the live active '
                      || 'count is %s (<90%%) -- the count query returned a collapsed value, which is '
                      || 'the 2026-08-16 head=True defect: .count returns 0 on supabase 2.10.0 and '
                      || 'resolve_kill_cap(0) yields the 150 floor while the log still looks normal',
                         v_run_denom, v_active);
    end if;
  else
    -- fallback: no recorded denominator. Live comparison, 5%% tolerance so growth alone cannot raise.
    v_expected := greatest(150, (v_active * 2 / 100)::int);
    if v_logged < (v_expected * 0.95)::int then
      v_reason := format('the run recorded no denominator and logged kill_cap=%s, more than 5%% below '
                      || 'the %s its live active count of %s implies', v_logged, v_expected, v_active);
    end if;
  end if;

  if v_reason is null then
    perform public.mon_resolve_key('liveness_cap_degraded', 'liveness_cap_degraded:gathern');
    return 0;
  end if;

  n := public.mon_raise('P2', 'liveness_cap_degraded', 'gathern',
    'liveness_cap_degraded:gathern',
    jsonb_build_object(
      'logged_cap', v_logged, 'run_denominator', v_run_denom, 'live_active_rows', v_active,
      'run_started_at', v_started, 'notes', v_notes, 'reason', v_reason,
      'why', 'A cap that is too TIGHT is not harmless: it quarantines legitimate batches as anomalies, '
          || 'and source-dead listings stay served to real users. FIX: check the count query in '
          || 'scrapers/gathern/liveness.py (it must NOT use head=True) rather than raising the floor. '
          || 'If the tighter cap is deliberate, pass --kill-cap so the run records "[override ...]" '
          || 'and this detector correctly stays quiet. NOTE (run #32): this detector judges the run '
          || 'against the denominator the RUN recorded, not one recomputed hours later -- ordinary '
          || 'inventory growth between the sweep and the sweep cannot raise it.'));
  return n;
end
$function$;
