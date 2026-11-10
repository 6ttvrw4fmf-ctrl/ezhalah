-- run_duration_explosion — A PACED RUN THAT FINISHED ITS WHOLE SLICE IS SLOW, NOT STALLED
-- (lane: dealapp + adjudication, 2026-11-09; alert_event 13962 run_duration_explosion:dealapp:10/24).
--
-- WHAT WAS MEASURED. dealapp:10/24 ran 00:36 → 03:13 UTC (157 min against a 33.7-min median) at
-- 15.3 rows/min (median 77.6), so mon_run_duration_is_stall() read it as a stall. The job log
-- (run 42540786228, job 128914994718) shows the opposite of a stall: «…100 parsed/upserted» every
-- 6-7 minutes from the first line to the last, 2,526 ids attempted, 2,394 upserted, 132 confirmed
-- absent, 0 time-budget misses, end_run() reached, ok=true. The night before the same shard did
-- 2,504 ids in 4 minutes. The difference is where the pages came from: when CloudFront holds the
-- slice, reads are edge hits and refund their slot; when the edge is cold (and every removed ad is
-- a forced origin render), every read is an ORIGIN render paced at 9/min per IP by OriginBudget —
-- the login-wall protection (dealapp-sharded.yml) — and 2,400 ids take ~160-280 minutes BY DESIGN
-- inside the 230-minute budget. Six other shards that night and eight the night before show the
-- same uniform-pace shape. Every request carries a 45 s timeout; no page hung.
--
-- THE RULE. The discriminator stays exactly as it is — a stalled run (souq24 134 min at 0 rows/min,
-- sanadak killed by CI, wasalt 0-row long run) still raises run_duration_explosion at P1. What
-- changes is that a run which FINISHED, ended ok=true, and captured at least 75% of its platform's
-- median rows is a different thing with a different response: it is SLOW and COMPLETE. It is raised
-- as its own kind, run_duration_slow_complete (P2), carrying the same payload plus the rows evidence,
-- so nothing is silenced and the two shapes stop sharing one name. mon_run_duration_is_stall() is
-- unchanged and its seven canonical cases still gate every sweep.

create or replace function public.mon_run_duration_shape(
  p_minutes numeric, p_med_minutes numeric, p_rpm numeric, p_med_rpm numeric,
  p_finished boolean, p_ok boolean, p_rows numeric, p_med_rows numeric)
returns text
language sql
immutable
as $function$
  select case
    when not public.mon_run_duration_is_stall(p_minutes, p_med_minutes, p_rpm, p_med_rpm) then null
    -- finished, healthy exit, and the slice is essentially whole: slow, not stalled
    when p_finished is true and p_ok is true
         and p_med_rows is not null and p_med_rows > 0
         and coalesce(p_rows, 0) >= 0.75 * p_med_rows then 'slow_complete'
    else 'stall'
  end;
$function$;

comment on function public.mon_run_duration_shape(numeric, numeric, numeric, numeric, boolean, boolean, numeric, numeric) is
  'null = healthy; ''stall'' = mon_run_duration_is_stall() and (dangling, or ok<>true, or rows '
  'collapsed below 75% of the platform median, or no rows baseline); ''slow_complete'' = the same '
  'wall-clock/throughput blow-up on a run that FINISHED ok with >= 75% of its median rows — paced, '
  'not stuck (dealapp origin pacing, 2026-11-09).';

create or replace function public.mon_detect_run_duration_explosion()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; live text[] := '{}'; live_slow text[] := '{}'; r record;
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
     -- shape (2026-11-09): the same stalls stay stalls; a finished, ok, whole-slice run is slow_complete
     or mon_run_duration_shape(134.0, 5.48,  0.0,  11.0, false, null,    0,  300) is distinct from 'stall'          -- souq24 dangling
     or mon_run_duration_shape( 89.5, 2.82,  0.0,  44.0, true,  false,   0,  120) is distinct from 'stall'          -- sanadak killed
     or mon_run_duration_shape(100.0, 20.0,  3.0,  50.0, true,  true,  300, 1000) is distinct from 'stall'          -- finished but rows collapsed
     or mon_run_duration_shape(100.0, 0.40, 50.0,  null, true,  true, 5000, null) is distinct from 'stall'          -- no baseline => stall
     or mon_run_duration_shape(156.9, 30.5, 15.3,  77.6, true,  true, 2394, 2450) is distinct from 'slow_complete'  -- dealapp:10/24 2026-11-09
     or mon_run_duration_shape(260.3, 0.37, 386.9, 268.6, true, true, 99999, 100) is not null                       -- healthy stays null
  then
    return public.mon_raise('P1', 'detector_discriminator_broken', 'monitoring',
      'detector_discriminator_broken:run_duration_explosion',
      jsonb_build_object(
        'detector', 'mon_detect_run_duration_explosion',
        'why', 'mon_run_duration_is_stall() / mon_run_duration_shape() no longer separate the canonical '
            || 'stall cases from the canonical healthy long-job and slow-complete cases. Until this is '
            || 'fixed the detector is NOT green, it is unmeasured, and a real capture stall would raise nothing.',
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
             (percentile_cont(0.5) within group (order by rows_seen)
               filter (where ok and rows_seen > 0))::numeric med_rows,
             (percentile_cont(0.95) within group (
               order by extract(epoch from (finished_at - started_at))/60.0)
               filter (where ok and rows_seen > 0))::numeric p95_ok_min,
             count(*) runs
        from public.scrape_runs
       where started_at >= now() - interval '18 days'
         and started_at <  now() - interval '24 hours'
         and finished_at is not null
       group by platform
      having count(*) >= 5
    ), shaped as (
      select s.platform,
             extract(epoch from (coalesce(s.finished_at, now()) - s.started_at))/60.0 as minutes,
             coalesce(s.rows_seen, 0)
               / nullif(extract(epoch from (coalesce(s.finished_at, now()) - s.started_at))/60.0, 0) as rpm,
             coalesce(s.rows_seen, 0) as rows_seen,
             b.med_min, b.med_rpm, b.med_rows,
             public.mon_run_duration_shape(
               (extract(epoch from (coalesce(s.finished_at, now()) - s.started_at))/60.0)::numeric,
               b.med_min,
               (coalesce(s.rows_seen, 0)
                 / nullif(extract(epoch from (coalesce(s.finished_at, now()) - s.started_at))/60.0, 0))::numeric,
               b.med_rpm,
               s.finished_at is not null, s.ok, coalesce(s.rows_seen, 0)::numeric, b.med_rows) as shape
        from public.scrape_runs s
        join base b on b.platform = s.platform
       where s.started_at >= now() - interval '24 hours'
         -- 2026-11-08: an in-flight run has rows_seen = 0 until end_run(); judge it only past 1.5x the longest healthy run.
         and (s.finished_at is not null
              or extract(epoch from (now() - s.started_at))/60.0 > 1.5 * coalesce(b.p95_ok_min, 0))
    ), cur as (
      select platform, shape,
             max(minutes)::numeric worst_min,
             count(*) slow_runs,
             min(rpm)::numeric worst_rpm,
             min(rows_seen)::numeric worst_rows,
             max(med_min) med_min, max(med_rpm) med_rpm, max(med_rows) med_rows
        from shaped
       where shape is not null
       group by platform, shape
    )
    select c.platform, c.shape, round(c.worst_min,1) worst_min, c.slow_runs,
           round(c.med_min,1) med_min, round(coalesce(c.worst_rpm,0),1) worst_rpm,
           round(coalesce(c.med_rpm,0),1) med_rpm,
           c.worst_rows, round(coalesce(c.med_rows,0)) med_rows
      from cur c
     order by c.worst_min desc
  loop
    if r.shape = 'stall' then
      live := live || ('run_duration_explosion:' || r.platform);
      n := n + public.mon_raise('P1', 'run_duration_explosion', r.platform,
        'run_duration_explosion:' || r.platform,
        jsonb_build_object('worst_minutes_24h', r.worst_min, 'slow_runs_24h', r.slow_runs,
          'baseline_median_minutes', r.med_min,
          'worst_rows_per_minute', r.worst_rpm, 'baseline_median_rows_per_minute', r.med_rpm,
          'worst_rows_seen', r.worst_rows, 'baseline_median_rows_seen', r.med_rows,
          'shape', 'STALL',
          'why', 'a run took many times this platform''s normal wall-clock AND its capture throughput '
              || 'collapsed below 25% of normal - so it STALLED, it did not merely take a long time. '
              || 'Left alone it is killed by its CI timeout, usually before end_run(), so it lands as '
              || 'a dangling or 0-row run and the real signal (it got SLOW, it was not blocked) is '
              || 'lost. souq24 went from 7-22 min to ~134 min on 2026-08-19 and simply died there '
              || 'every run after. A run that finished ok with >= 75% of its median rows is NOT here: '
              || 'it is raised as run_duration_slow_complete (2026-11-09).',
          'adjudicate', 'A slow run is throttling/latency, NOT a block - do not treat it as one. '
              || 'Check whether the work stalls in enumeration or in the per-item fetch loop, and '
              || 'whether the job holds a shared concurrency group while it hangs (that blocks '
              || 'unrelated recovery runs behind it). Raise the timeout only after the stall itself '
              || 'is explained. Throughput is in this payload: a healthy long JOB (a full enumeration, '
              || 'a deep fill) sustains its normal rows/min and no longer reaches this detector.'));
    else
      live_slow := live_slow || ('run_duration_slow_complete:' || r.platform);
      n := n + public.mon_raise('P2', 'run_duration_slow_complete', r.platform,
        'run_duration_slow_complete:' || r.platform,
        jsonb_build_object('worst_minutes_24h', r.worst_min, 'slow_runs_24h', r.slow_runs,
          'baseline_median_minutes', r.med_min,
          'worst_rows_per_minute', r.worst_rpm, 'baseline_median_rows_per_minute', r.med_rpm,
          'worst_rows_seen', r.worst_rows, 'baseline_median_rows_seen', r.med_rows,
          'shape', 'SLOW_COMPLETE',
          'why', 'a run took many times this platform''s normal wall-clock at a fraction of its normal '
              || 'rows/min, but it FINISHED, ended ok=true, and captured >= 75% of the platform''s '
              || 'median rows: the whole slice arrived, slowly. Measured 2026-11-09 on dealapp:10/24: '
              || '157 min at 15 rows/min, uniform from first to last log line — every page an origin '
              || 'render paced at 9/min per IP by design (CloudFront edge cold for the slice), 0 '
              || 'time-budget misses. That is pacing, not a stall, and raising the timeout or the '
              || 'pace would trip the source''s login wall.',
          'adjudicate', 'Read the job log timeline: a uniform rows/min from start to end is pacing '
              || '(edge-cold slice, throttled source); a flat line after some point is a stall and '
              || 'belongs to run_duration_explosion. Check the run finished inside its time budget '
              || 'with no not_reached_time_budget bucket. Nothing here is a block.'));
    end if;
  end loop;
  perform public.mon_resolve_stale_keys('run_duration_explosion', live);
  perform public.mon_resolve_stale_keys('run_duration_slow_complete', live_slow);
  return n;
end $function$;

-- Re-evaluate now: dealapp:10/24 moves from run_duration_explosion (resolved as stale) to
-- run_duration_slow_complete; every genuine stall re-raises under its old key.
select public.mon_detect_run_duration_explosion();
