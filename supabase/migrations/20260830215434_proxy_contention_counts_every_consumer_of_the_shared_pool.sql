-- The contention detector could not see a consumer that was about to exist.
--
-- mon_detect_proxy_contention() counts overlapping runs whose platform is `wasalt%` or `souq24`.
-- That list is not "who consumes the shared Saudi residential proxy" — it is "who consumed it in
-- August 2026". Its own adjudicate text says so: "check whether a NEW workflow started using
-- WASALT_PROXY_URL without being counted here."
--
-- Dealapp liveness is that new workflow. From GitHub Actions egress it reads ~88% shells and
-- quarantines every run (measured 2026-08-30: 300 probes, alive=37), so the proposal is to route
-- it through the shared pool. Before that can be safe the pool's own monitor has to be able to
-- count it — otherwise the first thing we would learn about contention is wasalt's failure rate
-- moving, which is exactly how 2026-08-17 cost five days (failure 0.1% -> 66.7%).
--
-- scrapers/dealapp/liveness_run.py logs proxy runs under the distinct platform label
-- `dealapp_liveness_proxy` and CI runs under `dealapp_liveness`, so this predicate counts the
-- consumer exactly when it IS one. The cap of 16 is unchanged — nothing here loosens anything.
create or replace function public.mon_detect_proxy_contention()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; peak int; when_peak timestamptz;
  concurrency_cap constant int := 16;
begin
  with runs as (
    select started_at s, coalesce(finished_at, now()) e
      from public.scrape_runs
     where started_at >= now() - interval '24 hours'
       -- Every consumer that authenticates with WASALT_PROXY_URL belongs here. Adding a proxy
       -- consumer means adding it to THIS predicate in the same change.
       and (platform like 'wasalt%' or platform = 'souq24'
            or platform = 'dealapp_liveness_proxy')
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
            || 'here (dealapp_liveness_proxy is counted; a further consumer must be added to this '
            || 'predicate). Do not raise the cap to silence this without evidence of the proxy '
            || 'plan''s real concurrent-session limit.'));
  else
    perform public.mon_resolve_key('proxy_contention', 'proxy_contention:shared_saudi_proxy');
  end if;
  return n;
end $function$;

do $verify$
declare src text; v int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_proxy_contention';
  if position('dealapp_liveness_proxy' in src) = 0 then
    raise exception 'the dealapp proxy consumer is still invisible to the contention detector';
  end if;
  if position('concurrency_cap constant int := 16' in src) = 0 then
    raise exception 'the concurrency cap moved - this change must not loosen it';
  end if;
  v := public.mon_detect_proxy_contention();
  raise notice 'proxy_contention raised % (expected 0)', v;
end $verify$;
