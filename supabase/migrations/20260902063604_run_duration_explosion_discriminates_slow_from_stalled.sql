-- run_duration_explosion fired on HEALTHY long runs, and that masked the real ones.
--
-- THE DEFECT. The detector groups scrape_runs by `platform` alone and compares a run's wall-clock
-- against that platform's MEDIAN wall-clock. For any platform whose run population is bimodal BY
-- DESIGN, the median describes the wrong mode:
--
--   wasalt          — 8-hourly per-category shard sweeps (~0.3 min, ~1,900 runs/18d) alongside the
--                     2-daily full enumeration gh-wasalt-enum-liveness (jobid 36, `0 21 */2 * *`),
--                     which takes 200-270 min BECAUSE THAT IS THE JOB. Median 0.37 min.
--   aqar_residential— 8-hourly sweeps (~0.4 min) alongside gh-aqar-deep-fill-weekly (jobid 56),
--                     30-130 min. Median 0.42 min.
--
-- So the enumeration is ~700x the median and trips `> 5 * median` every single time it runs. Measured:
-- run_duration_explosion:wasalt was raised on 08-23, 08-25, 08-27, 08-29, 08-31 and 09-01 — every
-- one at 21:59, one hour after the enumeration starts — and auto-resolved ~24h later, forever. Every
-- firing in the alert's lifetime was the scheduled job succeeding: run 39351 took 260.3 min and
-- captured 100,705 rows with ok=true.
--
-- WHY THAT IS NOT MERELY NOISE. mon_raise() returns 0 for an already-open dedup key. While
-- run_duration_explosion:wasalt sits open on a false positive, a GENUINE wasalt stall raises nothing
-- and pages nobody. The detector that exists to catch the stall is the reason the stall is invisible
-- — the same shape as the day-scoped stuck_open_alert false positive fixed on 2026-09-01, and the
-- nine dark detectors that once read as a clean bill of health (AGENTS.md).
--
-- THE FIX: make the cohort DISCRIMINATE, never widen the window. A stall and a long job differ in
-- THROUGHPUT, not in wall-clock. Over the 18-day baseline the separation is total, with no case
-- anywhere in between:
--
--   healthy long runs   wasalt enumeration      386.9-422.1 rows/min   138-157% of platform norm
--                       aqar_residential fill    78.2-146.7 rows/min    44-84% of platform norm
--   real stalls         souq24 47/126/134 min           0.0 rows/min             0% of norm
--                       sanadak 89.5 min (CI kill)      0.0 rows/min             0%
--                       wasalt 51/115/738 min           0.0 rows/min             0%
--                       aqar_residential 149.8/743.7    0.0 rows/min             0%
--
-- A 25% floor sits in the empty gap: 1.8x below the lowest healthy case, infinitely above every
-- stall. This can only ever REDUCE firing, and it strictly improves detection on wasalt and
-- aqar_residential, where the standing false positive was suppressing the true one outright.
--
-- FAIL SAFE. No throughput baseline (a platform that has never completed a run with rows > 0) means
-- we cannot discriminate, so we still raise — absence of evidence never downgrades to healthy. A
-- dangling run (finished_at null, rows null) reads as 0 rows/min and still raises, as before.

create or replace function mon_run_duration_is_stall(
  p_minutes     numeric,   -- this run's wall-clock
  p_med_minutes numeric,   -- platform's baseline median wall-clock
  p_rpm         numeric,   -- this run's rows/minute
  p_med_rpm     numeric    -- platform's baseline median rows/minute
) returns boolean
language sql immutable as $$
  select p_minutes is not null
     and p_minutes >= 30                              -- absolute floor, unchanged
     and p_med_minutes is not null
     and p_minutes > 5 * p_med_minutes                -- blow-up factor, unchanged
     and (
          p_med_rpm is null or p_med_rpm <= 0         -- no baseline => cannot discriminate => raise
       or coalesce(p_rpm, 0) < 0.25 * p_med_rpm       -- throughput collapsed => a real stall
     );
$$;

comment on function mon_run_duration_is_stall(numeric, numeric, numeric, numeric) is
  'True when a long run is a STALL rather than a long JOB: wall-clock blew up AND capture throughput collapsed below 25% of the platform norm. Fails safe (raises) when no throughput baseline exists.';

create or replace function public.mon_detect_run_duration_explosion()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; live text[] := '{}'; r record;
begin
  -- SELF-PROOF, every sweep. A detector whose discriminator has been broken reads as a clean bill of
  -- health, so prove it still separates the canonical production cases BEFORE trusting it. Cases are
  -- real rows from the 18-day baseline measured 2026-09-02 (see header). Fails LOUD, never silent.
  if    not mon_run_duration_is_stall(134.0, 5.48,   0.0,  11.0)    -- souq24 stall
     or not mon_run_duration_is_stall( 89.5, 2.82,   0.0,  44.0)    -- sanadak CI-timeout kill
     or not mon_run_duration_is_stall( 51.0, 0.37,   0.0, 268.6)    -- wasalt 0-row long run
     or not mon_run_duration_is_stall(100.0, 0.40,  50.0,  null)    -- no baseline => must still raise
     or     mon_run_duration_is_stall(260.3, 0.37, 386.9, 268.6)    -- wasalt full enumeration: healthy
     or     mon_run_duration_is_stall(104.9, 0.42,  78.2, 175.7)    -- aqar deep-fill: healthy
     or     mon_run_duration_is_stall( 10.0, 0.40,   0.0, 100.0)    -- below the 30-min floor
  then
    return public.mon_raise('P1', 'detector_discriminator_broken', 'monitoring',
      'detector_discriminator_broken:run_duration_explosion',
      jsonb_build_object(
        'detector', 'mon_detect_run_duration_explosion',
        'why', 'mon_run_duration_is_stall() no longer separates the canonical stall cases from the '
            || 'canonical healthy long-job cases. Until this is fixed the detector is NOT green, it '
            || 'is unmeasured, and a real capture stall would raise nothing.',
        'adjudicate', 'Re-derive the separation with the query in the migration header before '
            || 'changing any constant. Do NOT relax the assertions to make this pass.'));
  end if;

  for r in
    with base as (
      select platform,
             percentile_cont(0.5) within group (
               order by extract(epoch from (finished_at - started_at))/60.0)::numeric med_min,
             percentile_cont(0.5) within group (
               order by rows_seen / nullif(extract(epoch from (finished_at - started_at))/60.0, 0)
             ) filter (where ok and rows_seen > 0)::numeric med_rpm,
             count(*) runs
        from public.scrape_runs
       where started_at >= now() - interval '18 days'
         and started_at <  now() - interval '24 hours'
         and finished_at is not null
       group by platform
      having count(*) >= 5
    ), cur as (
      select s.platform,
             max(extract(epoch from (coalesce(s.finished_at, now()) - s.started_at))/60.0)::numeric worst_min,
             count(*) slow_runs,
             min(coalesce(s.rows_seen, 0)
                 / nullif(extract(epoch from (coalesce(s.finished_at, now()) - s.started_at))/60.0, 0)
             )::numeric worst_rpm
        from public.scrape_runs s
        join base b on b.platform = s.platform
       where s.started_at >= now() - interval '24 hours'
         and public.mon_run_duration_is_stall(
               (extract(epoch from (coalesce(s.finished_at, now()) - s.started_at))/60.0)::numeric,
               b.med_min,
               (coalesce(s.rows_seen, 0)
                 / nullif(extract(epoch from (coalesce(s.finished_at, now()) - s.started_at))/60.0, 0))::numeric,
               b.med_rpm)
       group by s.platform
    )
    select c.platform, round(c.worst_min,1) worst_min, c.slow_runs,
           round(b.med_min,1) med_min, round(coalesce(c.worst_rpm,0),1) worst_rpm,
           round(coalesce(b.med_rpm,0),1) med_rpm
      from cur c join base b using (platform)
     order by c.worst_min desc
  loop
    live := live || ('run_duration_explosion:' || r.platform);
    n := n + public.mon_raise('P1', 'run_duration_explosion', r.platform,
      'run_duration_explosion:' || r.platform,
      jsonb_build_object('worst_minutes_24h', r.worst_min, 'slow_runs_24h', r.slow_runs,
        'baseline_median_minutes', r.med_min,
        'worst_rows_per_minute', r.worst_rpm, 'baseline_median_rows_per_minute', r.med_rpm,
        'why', 'a run took many times this platform''s normal wall-clock AND its capture throughput '
            || 'collapsed below 25% of normal - so it STALLED, it did not merely take a long time. '
            || 'Left alone it is killed by its CI timeout, usually before end_run(), so it lands as '
            || 'a dangling or 0-row run and the real signal (it got SLOW, it was not blocked) is '
            || 'lost. souq24 went from 7-22 min to ~134 min on 2026-08-19 and simply died there '
            || 'every run after.',
        'adjudicate', 'A slow run is throttling/latency, NOT a block - do not treat it as one. '
            || 'Check whether the work stalls in enumeration or in the per-item fetch loop, and '
            || 'whether the job holds a shared concurrency group while it hangs (that blocks '
            || 'unrelated recovery runs behind it). Raise the timeout only after the stall itself '
            || 'is explained. Throughput is in this payload: a healthy long JOB (a full enumeration, '
            || 'a deep fill) sustains its normal rows/min and no longer reaches this detector.'));
  end loop;
  perform public.mon_resolve_stale_keys('run_duration_explosion', live);
  return n;
end $function$;

comment on function public.mon_detect_run_duration_explosion() is
  'P1: a scrape run whose wall-clock blew up AND whose throughput collapsed (a stall, not a long job). Carries its own discrimination proof; see mon_run_duration_is_stall.';
