-- LET THE HARNESSES SEE THE LOAD THEY ARE COLLECTIVELY CREATING (owner directive, 2026-09-04).
--
-- WHY. Staggering the scheduled workflows fixes the half of the load that has a cron line. It does
-- nothing for the other half, which is what actually degraded Search on 2026-09-04: seven daily
-- engineering routines running their harnesses interactively, each individually inside the §40.1
-- envelope of 1.5 searches/second and collectively at 2.5-3.2/s, with cron busy for ZERO seconds of
-- the worst sample window. Nothing can stagger that — the sessions are event-driven, not scheduled.
--
-- The only mechanism that bounds a sum whose terms are independent is for each term to be able to
-- SEE the sum. This RPC is that: any harness can ask "how loaded is Search right now?" and pace
-- itself accordingly.
--
-- WHAT IT IS NOT. Not a lock, not a quota, not an admission gate. It never refuses a search and
-- never returns fewer rows, because both would trade correctness coverage for latency and §33
-- forbids that outright. A harness that consults it runs exactly the same searches and makes
-- exactly the same assertions — it just spaces them out when the instance is already busy. Coverage
-- is identical; only wall-clock moves.
--
-- Reads ops_search_latency_sample, which is fed by mon_sample_search_latency() every 5 minutes from
-- pg_stat_statements. Costs one indexed read of a small table and issues no searches of its own —
-- a load probe that generated load would be self-defeating.
create or replace function public.ops_search_load_now()
returns table(recent_mean_ms numeric, search_qps numeric, samples int, safe_qps numeric, degraded boolean)
language sql stable security definer set search_path to 'public' as $$
  with w as (
    select delta_calls, delta_mean_ms, interval_s
      from public.ops_search_latency_sample
     where sampled_at > now() - interval '15 minutes'
       and delta_mean_ms is not null and delta_calls is not null
  ), agg as (
    select sum(delta_calls)::numeric  as calls,
           sum(interval_s)::numeric   as secs,
           case when sum(delta_calls) > 0
                then round((sum(delta_mean_ms * delta_calls) / sum(delta_calls))::numeric, 1) end as mean_ms,
           count(*)::int as n
      from w
  )
  select a.mean_ms,
         case when a.secs > 0 then round((a.calls / a.secs)::numeric, 2) end,
         a.n,
         1.5::numeric,
         -- "Degraded" is deliberately conservative: it takes BOTH a real latency cost AND enough
         -- traffic to be sure it is contention rather than one slow cold query. A harness that
         -- backed off on a single outlier would stretch every run for nothing.
         coalesce(a.mean_ms > 1200 and a.calls >= 20, false)
    from agg a
$$;

grant execute on function public.ops_search_load_now() to anon, authenticated, service_role;
