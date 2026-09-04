-- MONITORING MUST NEVER MATERIALLY DEGRADE USER-FACING SEARCH (owner directive, 2026-09-04).
--
-- WHY THIS AND NOT A SWEEP-OVERLAP LOCK. The question "is monitoring starving Search?" was asked
-- today and could not be answered from anything the system records. It took a live investigation to
-- establish that job 38 does NOT overlap itself (166-207 s typical, two 684 s outliers, against a
-- 1800 s interval and a 900 s statement_timeout, so self-overlap is structurally impossible), and
-- that warm server-side search is 135-195 ms — inside the 255 ms baseline. Both readings were
-- available only by hand. The gap is not a missing lock; it is that NOTHING WATCHES user-facing
-- search latency continuously:
--
--   mon_detect_search_performance_regression is gated to ~once per 20 h (mon_claim_daily_slot). It
--   sampled 07:29 today, recorded 0, and by construction cannot see a degradation that comes and
--   goes on a 30-minute cycle. A once-daily probe certifying "healthy" is exactly the shape of
--   false all-clear AGENTS.md already warns about.
--
-- WHAT THIS RECORDS. A delta over pg_stat_statements for the search RPC — REAL user traffic, not a
-- synthetic probe — so it costs one catalog read and adds ZERO query load to the path it measures.
-- Sampling the thing you are trying to protect by hammering it is self-defeating on a 2-vCPU box.
--
-- ATTRIBUTION IS THE POINT. Each sample also records how many seconds of cron/monitoring work ran
-- in the same interval. "Search is slow" and "monitoring made Search slow" are different claims and
-- the owner's rule is about the second one; without the second column every future investigation
-- repeats today's by hand.
create table if not exists public.ops_search_latency_sample (
  sampled_at      timestamptz primary key default now(),
  calls_total     bigint  not null,
  exec_ms_total   numeric not null,
  delta_calls     bigint,
  delta_mean_ms   numeric,
  cron_busy_s     numeric,
  interval_s      numeric
);

comment on table public.ops_search_latency_sample is
  'Delta samples of user-facing search RPC latency from pg_stat_statements, with concurrent cron busy-seconds for attribution. Written by mon_sample_search_latency(); read by mon_detect_search_latency_degraded().';

-- Sampler. Deliberately tolerant: a missing pg_stat_statements or a stats reset must not raise, it
-- must simply produce a row with a null delta — a monitoring gap is never a reason to page anyone,
-- and a negative delta (counters reset) is discarded rather than reported as a miraculous speedup.
create or replace function public.mon_sample_search_latency()
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_calls bigint; v_ms numeric; v_prev record; v_dc bigint; v_dms numeric; v_int numeric; v_cron numeric;
begin
  select coalesce(sum(s.calls),0), coalesce(sum(s.total_exec_time),0)
    into v_calls, v_ms
    from pg_stat_statements s
   where s.query ilike '%location_search_candidates_ar%';
  if v_calls = 0 then return; end if;

  select * into v_prev from public.ops_search_latency_sample order by sampled_at desc limit 1;

  if v_prev.sampled_at is not null and v_calls >= v_prev.calls_total and v_ms >= v_prev.exec_ms_total then
    v_dc  := v_calls - v_prev.calls_total;
    v_int := extract(epoch from (now() - v_prev.sampled_at));
    if v_dc > 0 then v_dms := round(((v_ms - v_prev.exec_ms_total) / v_dc)::numeric, 1); end if;
    -- Cron seconds that actually overlapped this interval, clipped to it, so a long job is not
    -- credited in full to a short window.
    select coalesce(sum(extract(epoch from (least(coalesce(d.end_time, now()), now())
                                          - greatest(d.start_time, v_prev.sampled_at)))), 0)
      into v_cron
      from cron.job_run_details d
     where d.start_time < now()
       and coalesce(d.end_time, now()) > v_prev.sampled_at;
  end if;

  insert into public.ops_search_latency_sample
    (sampled_at, calls_total, exec_ms_total, delta_calls, delta_mean_ms, cron_busy_s, interval_s)
  values (now(), v_calls, v_ms, v_dc, v_dms, greatest(v_cron, 0), v_int);

  delete from public.ops_search_latency_sample where sampled_at < now() - interval '30 days';
end $$;

-- Detector. Two independent limbs, because they catch different failures:
--   ABSOLUTE  — the user-facing mean over the recent window is bad enough to matter on its own.
--   RELATIVE  — the recent window is far worse than this system's OWN trailing behaviour, which
--               catches a regression that starts below the absolute ceiling.
-- A chronically slow system would hide a regression from the relative limb alone (the baseline
-- absorbs it) and a fast system would hide a real doubling from the absolute limb alone. Both.
create or replace function public.mon_detect_search_latency_degraded()
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  v_recent numeric; v_recent_calls bigint; v_base numeric; v_cron numeric; v_share numeric; v_sev text;
  v_secs numeric; v_qps numeric;
  c_abs_ms      constant numeric := 3000;   -- a user waiting >3 s for results is materially degraded
  c_rel_factor  constant numeric := 3.0;    -- 3x this system's own trailing median
  c_min_calls   constant bigint  := 30;     -- never judge a window nobody searched in
  -- §40.1 measured the safe envelope at <=1.5 searches/second sustained. Above that, the search
  -- path is contending with ITSELF, and on 2026-09-04 that was the actual cause: seven QA/live-check
  -- routines firing concurrently on a 2-vCPU instance drove ~3.8 searches/s and a 2,143 ms mean,
  -- while the SAME query warm and isolated ran in 135-195 ms. Without this limb the detector would
  -- have blamed the detector sweep, which was not even running.
  c_safe_qps    constant numeric := 1.5;
begin
  -- Recent window: the last hour of samples, weighted by calls so a quiet sample cannot dominate.
  select sum(delta_calls),
         case when sum(delta_calls) > 0
              then round((sum(delta_mean_ms * delta_calls) / sum(delta_calls))::numeric, 1) end
    into v_recent_calls, v_recent
    from public.ops_search_latency_sample
   where sampled_at > now() - interval '1 hour' and delta_mean_ms is not null;

  if v_recent is null or coalesce(v_recent_calls,0) < c_min_calls then
    perform public.mon_resolve_key('search_latency_degraded', 'search_latency_degraded');
    return 0;
  end if;

  -- Trailing baseline: median over 7 days, EXCLUDING the recent window so a sustained regression
  -- cannot quietly become its own baseline.
  select percentile_cont(0.5) within group (order by delta_mean_ms)
    into v_base
    from public.ops_search_latency_sample
   where sampled_at between now() - interval '7 days' and now() - interval '1 hour'
     and delta_mean_ms is not null and delta_calls >= 5;

  select coalesce(sum(cron_busy_s),0), coalesce(sum(interval_s),0)
    into v_cron, v_secs
    from public.ops_search_latency_sample
   where sampled_at > now() - interval '1 hour';
  v_share := case when v_secs > 0 then round((v_cron / v_secs)::numeric, 2) end;
  v_qps   := case when v_secs > 0 then round((v_recent_calls / v_secs)::numeric, 2) end;

  if v_recent <= c_abs_ms and (v_base is null or v_recent <= v_base * c_rel_factor) then
    perform public.mon_resolve_key('search_latency_degraded', 'search_latency_degraded');
    return 0;
  end if;

  v_sev := case when v_recent > c_abs_ms * 2 then 'P1' else 'P2' end;
  return public.mon_raise(v_sev, 'search_latency_degraded', 'all', 'search_latency_degraded',
    jsonb_build_object(
      'recent_mean_ms', v_recent,
      'recent_calls', v_recent_calls,
      'trailing_median_ms', v_base,
      'absolute_limit_ms', c_abs_ms,
      'relative_limit', c_rel_factor,
      'cron_busy_seconds_per_second', v_share,
      'search_qps', v_qps, 'safe_qps', c_safe_qps,
      'why', 'The user-facing search RPC is slow in real traffic (pg_stat_statements delta, not a synthetic probe). mon_detect_search_performance_regression samples once per ~20h and cannot see a degradation that comes and goes within the hour.',
      -- Ordered by what actually caused it on 2026-09-04. Self-inflicted QA load is checked FIRST
      -- because it is the cause an investigation is least likely to suspect and most likely to
      -- misattribute to the detector sweep.
      'attribution', case
        when v_qps is not null and v_qps > c_safe_qps then
          format('SELF-INFLICTED QA/HARNESS LOAD: %s searches/s exceeds the %s/s measured safe envelope (§40.1). The search path is contending with automated test traffic, not with users. Find the routine(s) firing concurrent sweeps and stagger them before touching anything in the query path.', v_qps, c_safe_qps)
        when v_share >= 1.0 then 'monitoring/cron was busy for MORE than the whole window (jobs overlap): degradation is plausibly monitoring-induced — owner rule 2026-09-04 says monitoring must never materially degrade user-facing Search'
        when v_share >= 0.5 then 'monitoring/cron busy for a large share of the window: check job durations before blaming the query plan'
        else 'neither QA load nor cron explains it: look at the query plan, index health, or organic traffic' end,
      'do_not', 'NEVER fix this by narrowing the search predicate, dropping a platform table, capping results, or weakening a detector. Correctness outranks latency (SEARCH_MATCH_QA_ENGINEER.md §33).'));
end $$;

-- Roster entry, in the SAME migration (mon_detect_orphaned_detectors flags anything the roster
-- cannot reach, and a detector outside the roster is decoration). GUARDED needle-edit of the LIVE
-- body — never a hand-pasted rebuild, which has silently dropped roster entries three times here.
do $$
declare
  v_def text; v_before text; fn text;
  want text[] := array['mon_detect_search_latency_degraded'];
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then
      v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
    end if;
  end loop;
  if v_def <> v_before then execute v_def; end if;
end $$;

do $$
declare v_def text; fn text; missing text[] := '{}';
  want text[] := array['mon_detect_search_latency_degraded','mon_detect_orphaned_detectors',
                       'mon_detect_search_scope_unreachable_inventory'];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then raise exception 'roster edit lost or failed to add: %', missing; end if;
end $$;

-- The sampler needs its own cadence: job 38's 30-minute period is far coarser than the phenomenon
-- (a sweep is ~3 minutes), so sampling from there could never attribute anything. Offset off :00,
-- :15 and :20 per the AGENTS.md slot rule, and off :29/:59 so the sampler is not itself queued
-- behind the very sweep it is measuring.
select cron.schedule('mon-search-latency-sample',
                     '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
                     $cron$ set statement_timeout to '20s'; select public.mon_sample_search_latency(); $cron$);
