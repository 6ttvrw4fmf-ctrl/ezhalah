-- A P0 that could not stay open: the frozen-scheduler detector treated "I cannot corroborate"
-- as "the condition is false" and RESOLVED itself, 22 times, across a 76-hour outage.
--
-- MEASURED (2026-09-18, routine #2):
--   jobid 28 sync-search-listings-ar -- the ONLY writer of the served search index -- last ran
--   2026-09-15 09:36Z. No listing entered search_listings_ar for 76h (max(first_seen_at) =
--   2026-09-15 08:48Z). pg_reload_conf() thawed it, as the alert's own remedy field said.
--
--   The detector fired 22 times in those 76h and auto-resolved every time. The resolves land at
--   :10 and :40, the raises at :13 and :42, every hour, deterministically. Cause: the "liveness
--   half" counts distinct jobids started in the last 10 MINUTES and requires >= 3 as proof that
--   cron itself is up. Measured over the last 12h at 5-minute granularity, that 10-minute count
--   drops to 0 routinely (worst 0, avg 11.2); at a 30-minute window the worst case is 20.
--   So every hour the detector lost its corroboration for benign reasons and, in that branch,
--   called mon_resolve_key() -- closing a live P0.
--
-- This is the repo's own owner-locked rule -- SOURCE IS TRUTH, silent -> NULL, never unknown -> NO
-- -- violated in the MONITORING layer. Unknown evidence cleared a P0 instead of holding it.
-- It also destroyed the alert's age: every re-raise is a new row, so "how long has this been
-- open?" always read minutes, never days, and no escalation path ever saw a 3-day-old P0.
--
-- Two changes, plus a barrier for the class:
--   1. The decision is lifted into mon_cron_frozen_verdict(n_frozen, n_alive), a pure function,
--      so the truth table can be EXECUTED rather than asserted about. UNKNOWN now HOLDS: it
--      neither raises nor resolves. Only n_frozen = 0 -- a real all-clear -- can resolve.
--   2. The liveness window widens 10m -> 30m so the corroboration is actually obtainable. The
--      bound is measured against recorded production, not reasoned from the predicate.
--   3. mon_detect_alert_flapping() watches the CLASS: any dedup_key repeatedly closed and
--      reopened is either a resolver clearing a still-true condition or a condition nobody has
--      adjudicated. 22 flaps in 3 days would have screamed.

-- 1 ------------------------------------------------------------------ the decision, executable
create or replace function public.mon_cron_frozen_verdict(n_frozen int, n_alive int)
returns text
language sql
immutable
as $function$
  select case
           -- A real all-clear, and the ONLY thing allowed to resolve the alert.
           when n_frozen = 0 then 'CLEAR'
           -- Cannot corroborate that cron itself is running. That is UNKNOWN, not "fine":
           -- if cron really is down the truth is WORSE, never better. Hold, never clear.
           when n_alive < 3 then 'UNKNOWN'
           else 'FROZEN'
         end
$function$;

comment on function public.mon_cron_frozen_verdict(int, int) is
  'Pure decision for mon_detect_cron_scheduler_frozen. UNKNOWN holds the alert; only CLEAR resolves it. Lifted out so the truth table is executed, not trusted (2026-09-18, routine #2).';

-- 2 ------------------------------------------------------------- the detector, now unknown-safe
create or replace function public.mon_detect_cron_scheduler_frozen()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rows_frozen  jsonb;
  n_frozen     int;
  n_alive      int;
  critical_hit boolean;
  verdict      text;
begin
  -- ONE evaluation of the predicate. Both the payload and the severity test read these same rows,
  -- so they cannot disagree and the lane pays for the scan once.
  create temporary table if not exists _frozen_now (
    jobid bigint, jobname text, median_interval_s double precision,
    runs_observed bigint, last_start timestamptz, overdue_factor numeric
  ) on commit drop;
  delete from _frozen_now;
  insert into _frozen_now select * from public.mon_cron_frozen_jobs();

  select count(*),
         coalesce(jsonb_agg(jsonb_build_object(
           'jobid', f.jobid, 'job', f.jobname,
           'median_interval_s', round(f.median_interval_s::numeric, 1),
           'last_start', f.last_start,
           'periods_missed', f.overdue_factor) order by f.overdue_factor desc), '[]'::jsonb)
    into n_frozen, rows_frozen
    from _frozen_now f;

  -- THE LIVENESS HALF. If cron itself is down, this is a different condition with different
  -- remedies, and saying "the scheduler is frozen" would be wrong. Require proof it is running.
  -- The window is 30 MINUTES, measured: over 12h of recorded production the distinct-job count in
  -- a 10-minute window bottoms out at 0 (so this test failed every hour for benign reasons and,
  -- in the old code, RESOLVED a live P0); at 30 minutes the worst case is 20.
  select count(distinct d.jobid) into n_alive
    from cron.job_run_details d
   where d.start_time > now() - interval '30 minutes';

  verdict := public.mon_cron_frozen_verdict(n_frozen, n_alive);

  if verdict = 'CLEAR' then
    perform public.mon_resolve_key('cron_scheduler_frozen', 'cron_scheduler_frozen');
    return 0;
  end if;

  if verdict = 'UNKNOWN' then
    -- HOLD. Not an all-clear, and not a raise either: we have no corroboration to raise ON.
    -- Whatever is already open stays open, with its original created_at intact.
    return 0;
  end if;

  -- The served search index has exactly one writer. If that is the job that got dropped, users stop
  -- seeing new listings and keep seeing dead ones, so this is not a P1.
  select exists(select 1 from _frozen_now f
                 where f.jobname in ('sync-search-listings-ar', 'refresh-listings',
                                     'sync-search-first-seen-at', 'refresh-location-index'))
    into critical_hit;

  return public.mon_raise(
    case when critical_hit then 'P0' else 'P1' end,
    'cron_scheduler_frozen', 'all', 'cron_scheduler_frozen',
    jsonb_build_object(
      'frozen_jobs', rows_frozen,
      'frozen_count', n_frozen,
      'other_jobs_running_last_30min', n_alive,
      'serving_impact', critical_hit,
      'why', 'These jobs have a long, regular, frequent history and have each missed 4+ consecutive '
             'periods, WHILE ' || n_alive || ' other jobs ran in the last 30 minutes. A job that is '
             'merely flaky does not go silent for hours while the scheduler keeps working: pg_cron '
             'is running a STALE in-memory copy of cron.job and no longer sees these entries. '
             'Observed in production on 2026-09-15: jobs 28/40/109 were dropped at 21:36-22:08 the '
             'night before and a job created fresh at 07:29 also never fired. Observed AGAIN '
             '2026-09-15 to 2026-09-18: the same three jobs, 76h, while this alert closed and '
             'reopened 22 times because its liveness window was too short to corroborate.',
      'remedy', 'Run `select pg_reload_conf();`. That is a SIGHUP, not a restart -- no disconnects '
                '-- and it makes pg_cron re-read cron.job. Confirm the thaw IMMEDIATELY by creating '
                'a throwaway `* * * * *` job and watching it fire within the minute (it will not '
                'fire at all if the scheduler is still frozen); the previously-frozen jobs only '
                'resume at their own next scheduled minute, so do not wait on them to tell you '
                'whether the reload worked. Then confirm each named job actually ran, and re-run '
                'the sync-dependent detectors (inactive_still_searchable, inactive_still_counted) '
                'which clear themselves once the index syncs.',
      'do_not', 'Do NOT treat this as contention. That was the standing guidance on the cron_health '
                'action text and it was measured and disproven here: concurrency was 1-2 against '
                'cron.max_running_jobs = 32. Do NOT change any job SCHEDULE to work around it '
                '(owner-only, and it fixes nothing), and do NOT unschedule a job while its run is '
                'in flight -- that cancels the running statement.'));
end
$function$;

-- 3 -------------------------------------------------- the class barrier: alerts that flap closed
create or replace function public.mon_flapping_alert_keys()
returns table(dedup_key text, kind text, raises int, closed int, first_raise timestamptz)
language sql
stable
set search_path to 'public'
as $function$
  select a.dedup_key,
         min(a.kind)::text,
         count(*)::int,
         count(*) filter (where a.resolved_at is not null)::int,
         min(a.created_at)
    from public.alert_event a
   where a.created_at > now() - interval '48 hours'
     and a.dedup_key is not null
   group by a.dedup_key
  having count(*) >= 4
     and count(*) filter (where a.resolved_at is not null) >= 3
$function$;

comment on function public.mon_flapping_alert_keys() is
  'A dedup_key closed and reopened 4+ times in 48h. Either a resolver is clearing a condition that is still true (cron_scheduler_frozen did exactly this across a 76h P0) or nobody has adjudicated a genuinely intermittent condition. Separate from the detector so it can be executed without writing an alert.';

create or replace function public.mon_detect_alert_flapping()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  rows_flapping jsonb;
  n_flapping    int;
begin
  select count(*),
         coalesce(jsonb_agg(jsonb_build_object(
           'dedup_key', f.dedup_key, 'kind', f.kind,
           'raises_48h', f.raises, 'times_closed', f.closed,
           'first_raise', f.first_raise) order by f.raises desc), '[]'::jsonb)
    into n_flapping, rows_flapping
    from public.mon_flapping_alert_keys() f;

  if n_flapping = 0 then
    perform public.mon_resolve_key('alert_flapping', 'alert_flapping');
    return 0;
  end if;

  return public.mon_raise('P1', 'alert_flapping', 'all', 'alert_flapping',
    jsonb_build_object(
      'flapping', rows_flapping,
      'flapping_count', n_flapping,
      'why', 'These alert keys have been RESOLVED and re-raised 4+ times in 48h. An alert that '
             'closes itself while its condition is still true is worse than no alert: the ops '
             'dashboard reads clean between flaps, every re-raise resets created_at so the age '
             'never grows, and no escalation path ever sees an old P0. Measured 2026-09-18: '
             'cron_scheduler_frozen flapped 22 times across a 76-hour P0 in which the only writer '
             'of the served search index was dead and no new listing became searchable.',
      'action', 'For each key, decide WHICH it is. (a) The resolver is wrong -- it treats '
                'unreachable/uncorroborated evidence as an all-clear. Fix it so UNKNOWN holds the '
                'alert and only a true negative resolves it. (b) The condition really is '
                'intermittent -- then adjudicate it once and give it a dedup window, do not let it '
                'churn. Do NOT silence this by widening the threshold.'));
end
$function$;

-- 4 ---------------------------------------------------------- roster: a detector nothing runs is
-- decoration. Own cron job rather than an edit to the ~200-name array inside
-- mon_run_all_detectors(), which several sessions edit concurrently. :21/:51 deliberately avoids
-- both the heavy :29/:59 sweep and the :00-:10 / :30-:40 quiet window this incident was about.
select cron.schedule('mon-alert-flapping', '21,51 * * * *',
                     $j$ set statement_timeout to '30s'; select public.mon_detect_alert_flapping(); $j$);

-- 5 -------------------------------------------------------------------- APPLY-TIME SELF-TESTS
-- Executed, not asserted about. The apply FAILS if any of these is wrong.
do $tests$
declare
  worst_30m int;
  worst_10m int;
begin
  -- T1-T6: the truth table, EXECUTED. T3/T4 are the defect this migration exists for: the old
  -- code returned the equivalent of CLEAR there and resolved a live P0.
  if public.mon_cron_frozen_verdict(0, 0)  <> 'CLEAR'   then raise exception 'T1 failed'; end if;
  if public.mon_cron_frozen_verdict(0, 50) <> 'CLEAR'   then raise exception 'T2 failed'; end if;
  if public.mon_cron_frozen_verdict(3, 0)  <> 'UNKNOWN' then raise exception 'T3 failed'; end if;
  if public.mon_cron_frozen_verdict(3, 2)  <> 'UNKNOWN' then raise exception 'T4 failed'; end if;
  if public.mon_cron_frozen_verdict(3, 3)  <> 'FROZEN'  then raise exception 'T5 failed'; end if;
  if public.mon_cron_frozen_verdict(3, 17) <> 'FROZEN'  then raise exception 'T6 failed'; end if;

  -- T7/T8: the widened window is justified against RECORDED PRODUCTION, not against the
  -- predicate's own reasoning. The old 10-minute window must be shown to fail (T7) and the new
  -- 30-minute window to hold with headroom (T8) over the last 12h of real run history.
  select min(x.n) into worst_10m from
    (select generate_series(now() - interval '12 hours', now(), interval '5 minutes') t) p
    cross join lateral (select count(distinct d.jobid) n from cron.job_run_details d
                         where d.start_time > p.t - interval '10 minutes' and d.start_time <= p.t) x;
  select min(x.n) into worst_30m from
    (select generate_series(now() - interval '12 hours', now(), interval '5 minutes') t) p
    cross join lateral (select count(distinct d.jobid) n from cron.job_run_details d
                         where d.start_time > p.t - interval '30 minutes' and d.start_time <= p.t) x;

  if worst_10m >= 3 then
    raise exception 'T7 failed: the 10-minute window bottomed out at %, so it never lost '
                    'corroboration and is not the cause this migration claims', worst_10m;
  end if;
  if worst_30m < 3 then
    raise exception 'T8 failed: the 30-minute window bottoms out at %, still below the threshold '
                    'of 3 -- widening it does not fix the corroboration failure', worst_30m;
  end if;

  -- T9: THE KNOWN-INCIDENT CASE MUST MATCH. A detector written about an incident that does not
  -- fire on that very incident is decoration (routine #15's near-miss, 2026-09-15).
  if not exists (select 1 from public.mon_flapping_alert_keys() where dedup_key = 'cron_scheduler_frozen') then
    raise exception 'T9 failed: the flapping detector does not match cron_scheduler_frozen, the '
                    'incident it was written for (12 raises / 11 closes in the last 48h)';
  end if;

  raise notice 'self-tests T1-T9 passed (worst 10m=%, worst 30m=%)', worst_10m, worst_30m;
end
$tests$;
