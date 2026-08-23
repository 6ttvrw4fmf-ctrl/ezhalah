-- Two corrections to the barrier suite applied minutes earlier, both found by actually RUNNING
-- the detectors against production instead of trusting that they worked.
--
-- (a) mon_detect_run_killed_by_timeout matched the bare word "killed", which appears in healthy
--     aqar_liveness notes as the METRIC "killed=0". It raised 34 alerts, 32 of them on runs with
--     ok=true that were reporting ZERO kills — a barrier asserting the exact opposite of the
--     truth. The pattern now requires a real kill phrase, and the dedup key collapses to the
--     platform FAMILY so one sharded sweep raises one alert instead of 32.
--
-- (b) mon_detect_rows_collapse could not see the incident it was written for. Its baseline window
--     (18d..3d ago) had absorbed six days of the collapse itself, dragging wasalt's median day to
--     7,056 and putting the ratio at 0.429 — comfortably "normal". That is the outage rewriting
--     normal, the same trap mon_detect_scraper_failure_step_change guards against. Baseline is now
--     p90 over 21 days, which a partial outage cannot drag down, and the threshold drops to 0.20
--     so the nearest healthy platform (eastabha, 0.291) has real daylight rather than sitting one
--     rounding error from a false positive.
--
--     Honest limitation, recorded rather than hidden: a 3-day rolling sum needs the last healthy
--     big-enumeration day to roll out of the window, so on wasalt's timeline this fires on day 3
--     of the incident, not day 1. That is deliberate — it is the backstop for a collapse where
--     runs still report ok=true. The day-1 signal is mon_detect_scraper_failure_step_change, which
--     did fire correctly on 2026-08-18.

create or replace function public.mon_detect_run_killed_by_timeout()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n int := 0; live text[] := '{}'; r record;
begin
  for r in
    select split_part(platform, ':', 1) as fam,
           count(*) kills,
           count(distinct platform) shards,
           max(started_at) last_kill,
           round(max(extract(epoch from (coalesce(finished_at, now()) - started_at))/60.0)::numeric,1) worst_min
      from public.scrape_runs
     where started_at >= now() - interval '72 hours'
       -- Must be a kill PHRASE. Bare "killed" also matches the healthy metric "killed=0".
       and notes ~* 'SIGINT|SIGKILL|timed out|timeout-minutes|operation was canceled|was cancelled|killed by'
     group by 1
     order by 2 desc
  loop
    live := live || ('run_killed_by_timeout:' || r.fam);
    n := n + public.mon_raise('P1', 'run_killed_by_timeout', r.fam,
      'run_killed_by_timeout:' || r.fam,
      jsonb_build_object('kills_72h', r.kills, 'shards_affected', r.shards,
        'last_kill', r.last_kill, 'worst_minutes', r.worst_min,
        'why', 'the CI job hit its timeout budget and the process was killed. end_run() usually '
            || 'does NOT get to run, so the row is left dangling or demoted to a 0-row failure - '
            || 'which reads like "blocked or empty source" and sends the next engineer down the '
            || 'wrong path entirely.',
        'adjudicate', 'Read this WITH mon_detect_run_duration_explosion: a kill is the symptom, '
            || 'the slowdown is the cause. Never raise timeout-minutes as the fix on its own. '
            || 'Check what the killed job was holding - a shared workflow concurrency group means '
            || 'it also blocked every other source and any recovery dispatch behind it.'));
  end loop;
  perform public.mon_resolve_stale_keys('run_killed_by_timeout', live);
  return n;
end $fn$;

create or replace function public.mon_detect_rows_collapse()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n int := 0; live text[] := '{}'; r record;
  collapse_ratio constant numeric := 0.20;
  min_baseline   constant numeric := 300;
begin
  for r in
    with cur as (
      select platform, sum(rows_seen)::numeric as rows_3d
        from public.scrape_runs
       where started_at >= now() - interval '3 days'
       group by platform
    ), base as (
      -- p90, not median: a platform mid-collapse still has its healthy days in this window, and
      -- p90 keeps reading them as normal where a median quietly re-baselines onto the outage.
      select platform,
             percentile_cont(0.90) within group (order by rows_d)::numeric as p90_day,
             count(*) as days
        from (select platform, date_trunc('day', started_at) d, sum(rows_seen)::numeric rows_d
                from public.scrape_runs
               where started_at >= now() - interval '21 days'
                 and started_at <  now() - interval '3 days'
               group by 1,2) z
       group by platform
    )
    select c.platform, c.rows_3d, b.p90_day, b.days,
           round(3 * b.p90_day, 0) as expected_3d,
           round(c.rows_3d / nullif(3 * b.p90_day, 0), 3) as ratio
      from cur c join base b using (platform)
     where b.days >= 7
       and 3 * b.p90_day >= min_baseline
       and c.rows_3d < collapse_ratio * 3 * b.p90_day
     order by c.rows_3d / nullif(3 * b.p90_day, 0)
  loop
    live := live || ('rows_collapse:' || r.platform);
    n := n + public.mon_raise('P1', 'rows_collapse', r.platform,
      'rows_collapse:' || r.platform,
      jsonb_build_object('rows_seen_3d', r.rows_3d, 'expected_3d', r.expected_3d,
        'baseline_p90_day', r.p90_day, 'baseline_days', r.days, 'ratio', r.ratio,
        'why', 'this platform is still RUNNING and may still report ok=true, but it is bringing '
            || 'back a small fraction of the rows it used to. Every count-based check stays green '
            || 'while the inventory silently goes stale - wasalt fell ~100k/day to ~3k/day on '
            || '2026-08-17 and no barrier noticed for five days.',
        'adjudicate', 'Compare against the source itself before touching code. If the source '
            || 'genuinely shrank, that is not an Ezhalah defect - record it. If the source is '
            || 'unchanged, look for a blocked/throttled egress path first '
            || '(mon_detect_proxy_block_spike) and a partial crawl second. Freeze deletions for '
            || 'this platform until the collapse is explained: a short crawl handed to '
            || 'prune_unseen() inactivates live listings.'));
  end loop;
  perform public.mon_resolve_stale_keys('rows_collapse', live);
  return n;
end $fn$;
