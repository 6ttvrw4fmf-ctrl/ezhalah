-- THE HOLE: mon_detect_cron_health's "job is overdue" grace window was derived by REGEX-MATCHING
-- the cron schedule STRING, and the regexes only recognised two forms:
--
--     '^\*/[0-9]+ '   -> 1h        (matches '*/10 * * * *')
--     '^[0-9]+ \* '   -> 2h        (matches '0 * * * *')
--     '\* \* [0-6]$'  -> 336h      (weekly)
--     everything else -> 48h       (the default)
--
-- Every OTHER common form fell to the 48-hour default, including the step-with-offset form this
-- database uses everywhere ('1-59/10 * * * *') and the comma form ('29,59 * * * *'). Measured
-- 2026-08-22 against the live roster:
--
--     jobid 25/75  resolve-aqar-locations etc  every 10 min  -> 48h grace  (285x its cadence)
--     jobid 22     refresh-loc-rel-signals     every 15 min  -> 48h grace  (189x)
--     jobid 50/53  30-minute monitors          every 30 min  -> 48h grace  (94x)
--     jobid 38     mon-detectors-and-dispatch  every 30 min  -> 48h grace  (90x)
--
-- jobid 38 is THE DETECTOR SWEEP. The job that runs every other detector could have stopped
-- firing entirely for two full days before cron_overdue said a word — a dark-monitoring hole
-- sitting inside the very detector written to prevent dark monitoring.
--
-- WHY THIS SURFACED (owner request, 2026-08-22). jobid 17 (hourly matview refresh) silently
-- skipped its 14:01 tick. Nothing alerted; the only signal was quarantine_growth firing on the
-- DOWNSTREAM symptom — listings stranded un-servable. The owner's instruction: alert on
-- "scheduled job expected -> no successful execution within its allowed grace window" directly,
-- so this never has to be inferred from downstream damage again.
--
-- THE FIX: stop parsing the schedule string. Derive the grace from what the job DEMONSTRABLY does
-- — the median gap between its own successful runs over the last 7 days — and keep the old
-- regex value as the fallback for jobs without enough history. Observed cadence cannot drift out
-- of sync with the schedule, because it IS the schedule's observed effect.
--
--     grace = max(median_gap * 2, 20 minutes)     when >= 5 observed gaps
--     grace = the old regex value                 otherwise (new/rare jobs behave exactly as before)
--
-- The 2x multiplier means one missed tick is tolerated and two is not. The 20-minute floor stops a
-- fast job from alerting on ordinary scheduler jitter.
--
-- MEASURED EFFECT (dry-run before applying, full active roster): ZERO jobs newly fire, so this
-- tightens the net without an alert storm. Hourly (17, 28: 120min) and daily (16: 2880min) are
-- UNCHANGED — this is strictly a fix for the forms the regex never recognised.

create or replace function public.mon_cron_expected_gap(p_jobid bigint, p_fallback_h int)
 returns interval
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with g as (
    select extract(epoch from (d.start_time
             - lag(d.start_time) over (order by d.start_time)))::numeric as gap_s
      from cron.job_run_details d
     where d.jobid = p_jobid
       and d.status = 'succeeded'
       and d.start_time > now() - interval '7 days'
  ), m as (
    select (percentile_cont(0.5) within group (order by gap_s))::numeric as med_s,
           count(*) as n
      from g
     where gap_s is not null and gap_s > 0
  )
  select case
           when m.n >= 5 and m.med_s is not null
             then make_interval(secs => greatest(m.med_s * 2, 1200)::double precision)
           else make_interval(hours => p_fallback_h)
         end
    from m;
$function$;

comment on function public.mon_cron_expected_gap(bigint, int) is
  'Grace window before a scheduled job counts as overdue, derived from the median gap between its '
  'own successful runs (x2, floor 20 min) rather than by regex-matching its cron schedule string. '
  'Falls back to the caller-supplied hours when fewer than 5 gaps are on record.';

-- Splice it into the live mon_detect_cron_health by NEEDLE-EDIT: read the real body, replace four
-- exact fragments, assert each one landed. Pasting a remembered body would silently discard any
-- change another session made to the branches this migration does not touch.
do $$
declare
  v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_cron_health';
  if v_def is null then raise exception 'mon_detect_cron_health is missing'; end if;

  if position('mon_cron_expected_gap' in v_def) > 0 then
    raise notice 'already spliced — nothing to do';
    return;
  end if;

  v_new := v_def;

  -- 1. declare the interval alongside the legacy int
  if position('overdue_h int;' in v_new) = 0 then
    raise exception 'needle 1 (declare) not found';
  end if;
  v_new := replace(v_new, 'overdue_h int;', 'overdue_h int;' || E'\n  v_grace interval;');

  -- 2. after the legacy case computes overdue_h, override it with the observed-cadence grace,
  --    passing the legacy value in as the fallback so low-history jobs keep today's behaviour.
  if position('else 24*2 end;' in v_new) = 0 then
    raise exception 'needle 2 (case tail) not found';
  end if;
  v_new := replace(v_new, 'else 24*2 end;',
    'else 24*2 end;' || E'\n    v_grace := public.mon_cron_expected_gap(rec.jobid, overdue_h);');

  -- 3. the overdue comparison uses the interval, not the coarse hour count
  if position('make_interval(hours => overdue_h)' in v_new) = 0 then
    raise exception 'needle 3 (comparison) not found';
  end if;
  v_new := replace(v_new, 'make_interval(hours => overdue_h)', 'v_grace');

  -- 4. report the grace actually applied, so an alert is readable without re-deriving it
  if position('''overdue_h'',overdue_h' in v_new) = 0 then
    raise exception 'needle 4 (payload) not found';
  end if;
  v_new := replace(v_new, '''overdue_h'',overdue_h',
    '''overdue_h'', round(extract(epoch from v_grace)::numeric/3600.0, 2),'
    || ' ''grace_basis'', case when abs(extract(epoch from v_grace)'
    || ' - overdue_h * 3600.0) < 1 then ''schedule-fallback'' else ''observed-cadence'' end');

  execute v_new;
end $$;

-- MUTATION PROOF, both directions, against the LIVE roster. A barrier that has only ever agreed
-- with the status quo has not been shown to do anything.
--
-- Note on tolerances: the observed median for an hourly job is 3600.000167s, not 3600s exactly —
-- pg_cron starts a job a few hundred microseconds off the minute. Every comparison here is
-- therefore made with a tolerance rather than by equality; a first attempt at this migration
-- failed on `<> interval '2 hours'` against a computed 02:00:00.000335.
do $$
declare
  v_grace interval;
  v_stale constant interval := interval '90 minutes';
begin
  -- (a) the detector sweep's own grace must now be tight
  v_grace := public.mon_cron_expected_gap(38, 48);
  if v_grace is null or v_grace > interval '75 minutes' then
    raise exception 'jobid 38 grace is % — expected ~60 min from its 30-min cadence', v_grace;
  end if;

  -- (b) POSITIVE: at 90 minutes stale the NEW grace must consider jobid 38 overdue
  if not (now() - v_stale < now() - v_grace) then
    raise exception 'new grace (%) does not flag the detector sweep at 90 minutes stale', v_grace;
  end if;

  -- (c) NEGATIVE CONTROL: the OLD 48h grace must NOT have flagged it. If it would have, this
  --     proof demonstrates nothing about the change.
  if (now() - v_stale < now() - make_interval(hours => 48)) then
    raise exception 'the old 48h grace also fires at 90 min — the mutation proves nothing';
  end if;

  -- (d) NO REGRESSION: an hourly job keeps the 2h window it already had (within a second).
  if abs(extract(epoch from public.mon_cron_expected_gap(17, 2)) - 7200) > 1 then
    raise exception 'jobid 17 grace moved to % — hourly must stay ~2h',
      public.mon_cron_expected_gap(17, 2);
  end if;

  -- (e) a job with no history at all falls back to exactly what it was given
  if public.mon_cron_expected_gap(-1, 48) <> interval '48 hours' then
    raise exception 'no-history fallback broken: got %', public.mon_cron_expected_gap(-1, 48);
  end if;
end $$;

-- The detector must still run clean on the live roster: this tightening is designed to add NO
-- new alerts today (dry-run measured 0). If it raises here, the assumption was wrong.
do $$
declare v_raised int;
begin
  v_raised := public.mon_detect_cron_health();
  if v_raised > 0 then
    raise exception 'tightened cron_health raised % alert(s) on the live roster — investigate '
                    'before shipping; the dry-run measured zero', v_raised;
  end if;
end $$;
