-- A LIVENESS JOB THAT STOPS RUNNING MUST BE AN ALARM (owner rule, 2026-09-21)
--
-- docs/ops/LISTING_LIVENESS.md §9, given after the owner's family found a dead gathern listing on
-- the live site: "if the liveness checker or its scheduled job stops working, Ezhalah must detect
-- THAT failure too, instead of silently accumulating stale listings."
--
-- WHY THE EXISTING DETECTOR COULD NOT SEE IT. mon_detect_silent_partial_success() asks exactly the
-- right question -- is this platform's last-24h rows_seen far below its own 18-day median -- but its
-- candidate set is RUNS THAT EXIST. A job that stops producing runs entirely contributes no row, so
-- there is nothing to compare against and nothing fires. Absence cannot be compared, so silence read
-- as health. Measured: wasalt's enumeration was dead 2026-09-12 -> 09-19 while the workflow reported
-- conclusion=success on every run, enumerating 96 rows instead of ~105,000; ~3,900 dead listings
-- stayed active and clickable, and a human found it by reading scrape_runs by hand.
--
-- This detector watches for EXPECTED-BUT-ABSENT runs instead: each job is measured against ITS OWN
-- observed cadence, so nothing has to be declared, registered or remembered.
--
-- THE SHARDED-JOB TRAP, caught by measuring before shipping rather than after. A first version took
-- the median of ALL inter-run gaps, which for wasalt_enum_shard is ~2 MINUTES: its 34 shards all
-- start within one batch. That made a healthy job look 1,714x overdue. Only gaps >= 30 minutes are
-- counted as cadence. Verified against the full fleet at write time: 39 job labels, ZERO would
-- alert, and the busiest healthy job sat at 1.5x against a 3.0x trigger.
create or replace function public.mon_detect_liveness_job_silent()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0; live text[] := '{}'; r record;
  min_batch_gaps  constant int     := 6;
  silence_factor  constant numeric := 3.0;
  floor_gap       constant interval := interval '6 hours';
  batch_gap_s     constant numeric := 1800;
begin
  for r in
    with labelled as (
      select platform, started_at,
             extract(epoch from (started_at - lag(started_at)
               over (partition by platform order by started_at)))::numeric gap_s
        from public.scrape_runs
       where started_at >= now() - interval '45 days'
         and (platform ilike '%liveness%' or platform ilike '%enum%'
              or platform ilike '%prune%'    or platform ilike '%cleanup%')
    ), cadence as (
      select platform,
             count(*) filter (where gap_s >= batch_gap_s) batch_gaps,
             (percentile_cont(0.5) within group (order by gap_s)
                filter (where gap_s >= batch_gap_s))::numeric median_gap_s,
             max(started_at) last_run
        from labelled
       group by platform
      having count(*) filter (where gap_s >= batch_gap_s) >= min_batch_gaps
    )
    select platform, batch_gaps, median_gap_s, last_run,
           extract(epoch from (now() - last_run))::numeric silent_s
      from cadence
     where median_gap_s > 0
       and (now() - last_run) > greatest(silence_factor * (median_gap_s * interval '1 second'),
                                         floor_gap)
     order by (extract(epoch from (now() - last_run))::numeric / nullif(median_gap_s,0)) desc
  loop
    live := live || ('liveness_job_silent:' || r.platform);
    n := n + public.mon_raise('P1', 'liveness_job_silent', r.platform,
      'liveness_job_silent:' || r.platform,
      jsonb_build_object(
        'job_label', r.platform,
        'last_run_at', r.last_run,
        'hours_silent', round(r.silent_s/3600.0, 1),
        'own_cadence_hours', round(r.median_gap_s/3600.0, 2),
        'overdue_by_cycles', round(r.silent_s / nullif(r.median_gap_s,0), 1),
        'observed_batch_gaps', r.batch_gaps,
        'why', 'A job that decides whether listings are still alive has STOPPED RUNNING. It is not '
            || 'reporting failures, because it is not reporting at all -- and nothing downstream can '
            || 'tell that apart from a healthy platform with nothing to remove. Measured on '
            || '2026-09-21: wasalt''s enumeration was dead for SEVEN DAYS while its workflow '
            || 'reported success on every run, and ~3,900 dead listings stayed active and clickable '
            || 'the whole time (docs/ops/LISTING_LIVENESS.md 9.2).',
        'action', 'Find why the scheduled job stopped EXECUTING -- a cron row that fires but '
            || 'dispatches nothing, a workflow that succeeds while doing no work, a blocked '
            || 'transport, an expired credential. Check cron.job_run_details for the dispatch AND '
            || 'scrape_runs for the work: a green dispatch with no run row is the exact shape this '
            || 'exists to catch. Fix the job; then prove the next SCHEDULED run lands, not a manual one.',
        'do_not', 'Do NOT treat the backlog this created as evidence of death, and do NOT lower a '
            || 'coverage floor, raise a kill cap or widen a strike to catch up. A checker that was '
            || 'not running leaves every listing it would have touched UNKNOWN, and UNKNOWN never '
            || 'deactivates anything (LISTING_LIVENESS.md 1, 7, 9.3). Restoring the job is the '
            || 'only fix. A restorative write -- proving listings ALIVE -- is never gated.'));
  end loop;
  perform public.mon_resolve_stale_keys('liveness_job_silent', live);
  return n;
end
$function$;

comment on function public.mon_detect_liveness_job_silent() is
  'Owner rule 2026-09-21 (LISTING_LIVENESS.md 9): a liveness/enum/prune/cleanup job that has gone '
  'silent for 3x its own observed cadence raises P1 liveness_job_silent. Complements '
  'mon_detect_silent_partial_success(), which can only compare runs that EXIST and is therefore '
  'blind to a job that stops entirely. Cadence is measured between BATCHES (gaps >= 30 min) so a '
  'sharded job is not judged by its intra-batch spacing.';

do $roster$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src is null then
    raise exception 'mon_run_all_detectors() not found -- cannot register the detector';
  end if;
  if src like '%mon_detect_liveness_job_silent%' then
    raise notice 'already rostered';
    return;
  end if;
  patched := replace(src, 'fns text[] := array[',
                          'fns text[] := array[' || E'\n    ' ||
                          quote_literal('mon_detect_liveness_job_silent') || ',');
  if patched = src then
    raise exception 'roster anchor not found -- refusing to register blindly';
  end if;
  execute patched;
end
$roster$;

do $assert$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src not like '%mon_detect_liveness_job_silent%' then
    raise exception 'detector did not land in the mon_run_all_detectors roster';
  end if;
  if to_regprocedure('public.mon_detect_liveness_job_silent()') is null then
    raise exception 'detector function missing';
  end if;
end
$assert$;