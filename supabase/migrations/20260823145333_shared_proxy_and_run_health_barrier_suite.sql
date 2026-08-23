-- Shared-proxy / run-health barrier suite (owner-approved 2026-08-23, alongside PR #827).
--
-- Context. wasalt's daily run-failure rate stepped 0.0% -> 57.8-69.1% on 2026-08-17 and stayed
-- there for a week; its daily rows_seen fell ~100k -> ~3k. souq24 died on 2026-08-19 and its last
-- three scheduled runs were SIGINT-killed at ~134 min with ZERO rows. Between them these two
-- incidents went 5 and 7 days without a single barrier firing for the thing that actually hurt:
-- mon_detect_scraper_failure_step_change caught wasalt's RATE (and only wasalt), and nothing at
-- all caught the row collapse, the duration explosion, the timeout kills, or the fact that a
-- shared proxy was the common resource. These eight close that gap.
--
-- Cheapness note: every one of these is a small aggregate over scrape_runs / cleanup_runs on a
-- started_at window. That is deliberate. The 2026-08-23 audit found mon_run_all_detectors' p10
-- runtime had already grown 21.5s -> 145.3s against a 900s ceiling, so adding eight detectors
-- has to cost close to nothing or it makes a real problem worse.

-- 2. proxy / block spike
create or replace function public.mon_detect_proxy_block_spike()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n int := 0; live text[] := '{}'; r record;
  min_runs constant int := 10;
  pct_floor constant numeric := 25;
begin
  for r in
    select platform,
           count(*) as runs,
           count(*) filter (where notes ~* '(proxy|network) block|blocked|\m403\M|\m429\M') as blocked,
           round(100.0 * count(*) filter (where notes ~* '(proxy|network) block|blocked|\m403\M|\m429\M')
                 / nullif(count(*),0), 1) as pct
      from public.scrape_runs
     where started_at >= now() - interval '24 hours'
     group by platform
    having count(*) >= min_runs
       and round(100.0 * count(*) filter (where notes ~* '(proxy|network) block|blocked|\m403\M|\m429\M')
                 / nullif(count(*),0), 1) >= pct_floor
     order by 4 desc
  loop
    live := live || ('proxy_block_spike:' || r.platform);
    n := n + public.mon_raise('P1', 'proxy_block_spike', r.platform,
      'proxy_block_spike:' || r.platform,
      jsonb_build_object('runs_24h', r.runs, 'blocked_24h', r.blocked, 'blocked_pct', r.pct,
        'why', 'a large share of this platform''s runs reported a proxy/network block or an '
            || 'explicit 403/429. That is an EGRESS problem, not a parser problem.',
        'adjudicate', 'Do NOT "fix" a scraper that did not change. Check whether other platforms '
            || 'sharing the same proxy secret are blocked in the same window '
            || '(mon_detect_proxy_contention), then check the proxy account itself - concurrent-'
            || 'session limit, bandwidth quota, or an IP-pool ban. NEVER let a run from this '
            || 'window drive an inactivation or a deletion: the evidence is unreliable by '
            || 'construction.'));
  end loop;
  perform public.mon_resolve_stale_keys('proxy_block_spike', live);
  return n;
end $fn$;

-- 3. rows-seen / upsert collapse
-- Deliberately a 3-DAY rolling sum against a MEDIAN daily baseline, not day-vs-day. wasalt's
-- enumeration alternates a big day (~100k) with a small one (~7k), so a naive day-vs-median check
-- would have screamed every other day for months and been muted long before it was needed.
create or replace function public.mon_detect_rows_collapse()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n int := 0; live text[] := '{}'; r record;
  collapse_ratio constant numeric := 0.30;
  min_baseline   constant numeric := 300;
begin
  for r in
    with cur as (
      select platform, sum(rows_seen)::numeric as rows_3d
        from public.scrape_runs
       where started_at >= now() - interval '3 days'
       group by platform
    ), base as (
      select platform,
             percentile_cont(0.5) within group (order by rows_d)::numeric as median_day,
             count(*) as days
        from (select platform, date_trunc('day', started_at) d, sum(rows_seen)::numeric rows_d
                from public.scrape_runs
               where started_at >= now() - interval '18 days'
                 and started_at <  now() - interval '3 days'
               group by 1,2) z
       group by platform
    )
    select c.platform, c.rows_3d, b.median_day, b.days,
           round(3 * b.median_day, 0) as expected_3d
      from cur c join base b using (platform)
     where b.days >= 7
       and 3 * b.median_day >= min_baseline
       and c.rows_3d < collapse_ratio * 3 * b.median_day
     order by c.rows_3d / nullif(3 * b.median_day, 0)
  loop
    live := live || ('rows_collapse:' || r.platform);
    n := n + public.mon_raise('P1', 'rows_collapse', r.platform,
      'rows_collapse:' || r.platform,
      jsonb_build_object('rows_seen_3d', r.rows_3d, 'expected_3d', r.expected_3d,
        'baseline_median_day', r.median_day, 'baseline_days', r.days,
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

-- 4. silent partial success (the raghdan 249-of-376 shape: ok=true but the capture was short)
create or replace function public.mon_detect_silent_partial_success()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n int := 0; live text[] := '{}'; r record;
  short_ratio constant numeric := 0.50;
  min_runs    constant int := 5;
begin
  for r in
    with base as (
      select platform, percentile_cont(0.5) within group (order by rows_seen)::numeric median_rows,
             count(*) runs
        from public.scrape_runs
       where started_at >= now() - interval '18 days'
         and started_at <  now() - interval '24 hours'
         and ok is true and rows_seen > 0
       group by platform
      having count(*) >= min_runs
    ), cur as (
      select platform, min(rows_seen)::numeric worst, count(*) short_runs
        from public.scrape_runs s
       where started_at >= now() - interval '24 hours'
         and ok is true and rows_seen > 0
         and rows_seen < short_ratio * (select median_rows from base b where b.platform = s.platform)
       group by platform
    )
    select c.platform, c.worst, c.short_runs, b.median_rows
      from cur c join base b using (platform)
     order by c.worst / nullif(b.median_rows,0)
  loop
    live := live || ('silent_partial_success:' || r.platform);
    n := n + public.mon_raise('P1', 'silent_partial_success', r.platform,
      'silent_partial_success:' || r.platform,
      jsonb_build_object('worst_rows_seen_24h', r.worst, 'short_runs_24h', r.short_runs,
        'baseline_median_rows', r.median_rows,
        'why', 'a run REPORTED SUCCESS while capturing far fewer rows than this platform normally '
            || 'does. This is the most dangerous shape in the system: ok=true suppresses every '
            || 'failure barrier, and the short list is then handed to prune_unseen(), which '
            || 'inactivates the listings that simply were not captured.',
        'adjudicate', 'Find where the capture stopped early - a truncated sitemap/stream, a '
            || 'pagination cut-off, or an enumeration that gave up mid-way. A scraper must treat '
            || 'an unprovable/partial catalogue as a FAILED attempt, never as a small catalogue. '
            || 'Verify no inactivation ran off this run before anything else.'));
  end loop;
  perform public.mon_resolve_stale_keys('silent_partial_success', live);
  return n;
end $fn$;

-- 5. run duration explosion
create or replace function public.mon_detect_run_duration_explosion()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n int := 0; live text[] := '{}'; r record;
  blowup_factor constant numeric := 5;
  abs_floor_min constant numeric := 30;
  min_runs      constant int := 5;
begin
  for r in
    with base as (
      select platform,
             percentile_cont(0.5) within group (
               order by extract(epoch from (finished_at - started_at))/60.0)::numeric med_min,
             count(*) runs
        from public.scrape_runs
       where started_at >= now() - interval '18 days'
         and started_at <  now() - interval '24 hours'
         and finished_at is not null
       group by platform
      having count(*) >= min_runs
    ), cur as (
      select platform,
             max(extract(epoch from (coalesce(finished_at, now()) - started_at))/60.0)::numeric worst_min,
             count(*) slow_runs
        from public.scrape_runs s
       where started_at >= now() - interval '24 hours'
         and extract(epoch from (coalesce(finished_at, now()) - started_at))/60.0 >= abs_floor_min
         and extract(epoch from (coalesce(finished_at, now()) - started_at))/60.0
             > blowup_factor * (select med_min from base b where b.platform = s.platform)
       group by platform
    )
    select c.platform, round(c.worst_min,1) worst_min, c.slow_runs, round(b.med_min,1) med_min
      from cur c join base b using (platform)
     order by c.worst_min desc
  loop
    live := live || ('run_duration_explosion:' || r.platform);
    n := n + public.mon_raise('P1', 'run_duration_explosion', r.platform,
      'run_duration_explosion:' || r.platform,
      jsonb_build_object('worst_minutes_24h', r.worst_min, 'slow_runs_24h', r.slow_runs,
        'baseline_median_minutes', r.med_min,
        'why', 'a run took many times this platform''s normal wall-clock. Left alone it is killed '
            || 'by its CI timeout, usually before end_run(), so it lands as a dangling or 0-row '
            || 'run and the real signal (it got SLOW, it was not blocked) is lost. souq24 went '
            || 'from 7-22 min to ~134 min on 2026-08-19 and simply died there every run after.',
        'adjudicate', 'A slow run is throttling/latency, NOT a block - do not treat it as one. '
            || 'Check whether the work stalls in enumeration or in the per-item fetch loop, and '
            || 'whether the job holds a shared concurrency group while it hangs (that blocks '
            || 'unrelated recovery runs behind it). Raise the timeout only after the stall itself '
            || 'is explained.'));
  end loop;
  perform public.mon_resolve_stale_keys('run_duration_explosion', live);
  return n;
end $fn$;

-- 6. SIGINT / timeout kills
create or replace function public.mon_detect_run_killed_by_timeout()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n int := 0; live text[] := '{}'; r record;
begin
  for r in
    select platform, count(*) kills, max(started_at) last_kill,
           round(max(extract(epoch from (coalesce(finished_at, now()) - started_at))/60.0)::numeric,1) worst_min
      from public.scrape_runs
     where started_at >= now() - interval '72 hours'
       and notes ~* 'SIGINT|timeout-minutes|timed out|killed|was cancelled|operation was canceled'
     group by platform
     order by 2 desc
  loop
    live := live || ('run_killed_by_timeout:' || r.platform);
    n := n + public.mon_raise('P1', 'run_killed_by_timeout', r.platform,
      'run_killed_by_timeout:' || r.platform,
      jsonb_build_object('kills_72h', r.kills, 'last_kill', r.last_kill, 'worst_minutes', r.worst_min,
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

-- 7. shared-proxy contention: directly guards what PR #827 bought
create or replace function public.mon_detect_proxy_contention()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n int := 0; peak int; when_peak timestamptz;
  concurrency_cap constant int := 16;
begin
  with runs as (
    select started_at s, coalesce(finished_at, now()) e
      from public.scrape_runs
     where started_at >= now() - interval '24 hours'
       and (platform like 'wasalt%' or platform = 'souq24')
       and coalesce(finished_at, now()) > started_at
  ), ev as (
    select s as t, 1 as d from runs
    union all
    select e as t, -1 as d from runs
  ), running as (
    select t, sum(d) over (order by t, d rows between unbounded preceding and current row) concur
      from ev
  )
  select max(concur), (select t from running order by concur desc, t limit 1)
    into peak, when_peak
    from running;

  if coalesce(peak,0) > concurrency_cap then
    n := n + public.mon_raise('P1', 'proxy_contention', 'wasalt',
      'proxy_contention:shared_saudi_proxy',
      jsonb_build_object('peak_concurrent_runs', peak, 'cap', concurrency_cap, 'peak_at', when_peak,
        'why', 'more proxy-consuming runs overlapped than the shared Saudi residential proxy is '
            || 'capped for. Every one of them authenticates with the SAME WASALT_PROXY_URL '
            || 'secret, so they compete for one pool of concurrent sessions. Exceeding it does '
            || 'not fail cleanly: requests plateau at a connect timeout (~204s measured) while '
            || 'other jobs in the same batch succeed in seconds, which looks like a random, '
            || 'per-slug source block and is not one.',
        'adjudicate', 'Check max-parallel on wasalt-residential-sweep.yml AND '
            || 'wasalt-commercial-sweep.yml - they fire 5 minutes apart into SEPARATE concurrency '
            || 'groups, so they overlap by design and only capping BOTH bounds the peak. Also '
            || 'check whether a NEW workflow started using WASALT_PROXY_URL without being counted '
            || 'here. Do not raise the cap to silence this without evidence of the proxy plan''s '
            || 'real concurrent-session limit.'));
  else
    perform public.mon_resolve_key('proxy_contention', 'proxy_contention:shared_saudi_proxy');
  end if;
  return n;
end $fn$;

-- 8. destructive op while source health is degraded
create or replace function public.mon_detect_inactivation_during_degraded_source()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n int := 0; live text[] := '{}'; r record;
  degraded_pct constant numeric := 30;
begin
  for r in
    with health as (
      select platform,
             round(100.0 * count(*) filter (where ok is false) / nullif(count(*),0), 1) fail_pct,
             count(*) runs
        from public.scrape_runs
       where started_at >= now() - interval '48 hours'
       group by platform
      having count(*) >= 5
    ), destructive as (
      select platform, sum(deleted) deleted, count(*) runs
        from public.cleanup_runs
       where ran_at >= now() - interval '48 hours'
         and dry_run is false and aborted is false
       group by platform
      having sum(deleted) > 0
    )
    select d.platform, d.deleted, h.fail_pct, h.runs
      from destructive d join health h using (platform)
     where h.fail_pct >= degraded_pct
     order by d.deleted desc
  loop
    live := live || ('destructive_op_on_degraded_source:' || r.platform);
    n := n + public.mon_raise('P1', 'destructive_op_on_degraded_source', r.platform,
      'destructive_op_on_degraded_source:' || r.platform,
      jsonb_build_object('deleted_48h', r.deleted, 'source_failure_pct_48h', r.fail_pct,
        'runs_48h', r.runs,
        'why', 'rows were PERMANENTLY DELETED for a platform whose own capture was failing over '
            || 'the same window. Deletion is irreversible; a degraded source is exactly when '
            || '"gone" and "unreachable" become indistinguishable.',
        'adjudicate', 'cleanup.py re-probes every row and refuses to delete on 403/429/5xx/network '
            || 'error, and since 2026-08-23 it freezes the WHOLE run when the inconclusive rate '
            || 'clears 30%. If deletions still happened here, establish which of those held and '
            || 'why the run was trusted. Restore from cleanup_deletion_log if the evidence does '
            || 'not stand up.'));
  end loop;
  perform public.mon_resolve_stale_keys('destructive_op_on_degraded_source', live);
  return n;
end $fn$;

-- 9. deletion not backed by conclusive per-row evidence (DB counterpart to cleanup.py's freeze)
create or replace function public.mon_detect_deletion_on_inconclusive_evidence()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n int := 0; live text[] := '{}'; r record;
begin
  for r in
    select platform, id, ran_at, deleted, rechecked, skipped,
           round(100.0 * skipped / nullif(rechecked + skipped, 0), 1) inconclusive_pct
      from public.cleanup_runs
     where ran_at >= now() - interval '7 days'
       and dry_run is false and aborted is false
       and deleted > 0
       and (rechecked < deleted
            or 100.0 * skipped / nullif(rechecked + skipped, 0) > 30)
     order by ran_at desc
  loop
    live := live || ('deletion_on_inconclusive_evidence:' || r.platform || ':' || r.id);
    n := n + public.mon_raise('P0', 'deletion_on_inconclusive_evidence', r.platform,
      'deletion_on_inconclusive_evidence:' || r.platform || ':' || r.id,
      jsonb_build_object('cleanup_run_id', r.id, 'ran_at', r.ran_at, 'deleted', r.deleted,
        'rechecked', r.rechecked, 'skipped', r.skipped, 'inconclusive_pct', r.inconclusive_pct,
        'why', 'a cleanup run permanently deleted rows either without re-verifying at least that '
            || 'many, or while a large share of its probes came back with no usable evidence. '
            || 'Both mean listings may have been destroyed because the SOURCE was unreachable, '
            || 'not because the ads were gone. This is P0 because it is not reversible in place.',
        'adjudicate', 'Read cleanup_deletion_log for this run_id - every deleted row records its '
            || 'http_status and verdict. Any row deleted on a status other than 404/410, or on a '
            || '200 without the platform''s dead-marker, was deleted wrongly and must be restored. '
            || 'Then establish why cleanup.py''s per-row rule and run-level freeze did not hold.'));
  end loop;
  perform public.mon_resolve_stale_keys('deletion_on_inconclusive_evidence', live);
  return n;
end $fn$;

-- roster wiring. A detector outside mon_run_all_detectors is decoration (AGENTS.md), and
-- mon_detect_orphaned_detectors() fires on anything nothing reaches. Patch the existing roster
-- array in place rather than retyping 96 entries - retyping risks silently DROPPING a detector,
-- which is the exact failure this rule exists to prevent. Idempotent: re-running is a no-op.
do $do$
declare
  src text;
  newnames constant text[] := array[
    'mon_detect_proxy_block_spike',
    'mon_detect_rows_collapse',
    'mon_detect_silent_partial_success',
    'mon_detect_run_duration_explosion',
    'mon_detect_run_killed_by_timeout',
    'mon_detect_proxy_contention',
    'mon_detect_inactivation_during_degraded_source',
    'mon_detect_deletion_on_inconclusive_evidence'];
  nm text;
  ins text := '';
  anchor constant text := '  fns text[] := array[' || E'\n';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to wire detectors into nothing';
  end if;

  foreach nm in array newnames loop
    if position('''' || nm || '''' in src) = 0 then
      ins := ins || '    ''' || nm || ''',' || E'\n';
    end if;
  end loop;

  if ins = '' then
    raise notice 'roster already carries every new detector - nothing to do';
    return;
  end if;
  if position(anchor in src) = 0 then
    raise exception 'roster array anchor not found - refusing to patch blind';
  end if;

  src := replace(src, anchor, anchor || ins);
  execute src;
end $do$;
