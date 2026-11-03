-- oracle_never_retires reads the platform's ORACLE, not one caller's label of it.
--
-- fleet_liveness.py runs exactly the callable a crawl hands to db.prune_unseen() (its SITES map is
-- "platform -> its scraper's own measured oracle, exactly what it hands to db.prune_unseen()"), and
-- records that callable's GONE answers as oracle = 'fleet_liveness.<platform>'. Both functions below
-- counted only 'prune_unseen.verify_gone', so a platform whose oracle had retired listings through
-- the fleet read "asked N times, ZERO affirmative" whenever its crawl-side asks happened to be the
-- undecidable ones. Measured 2026-11-03: suwar -- 43 crawl asks all UNKNOWN (REST 401 + own page 200,
-- correctly no opinion), while the SAME _verify_gone returned GONE 7 times through the fleet (own page
-- 404) -- so the alarm's claim "it can never RETIRE anything" was false. sakani, the other open row,
-- has zero GONE through either caller and stays flagged: both directions measured on production.
--
-- Other oracle labels (sakani.sold_pin.ad_end_date, res_com.sibling_classified_this_run,
-- lifecycle_spot_check.*) are NOT the platform's verify_gone and are still not counted.
-- Shared judgement: scripts/lib/oracleRetirement.ts (isRetirementOracleLabel).
create or replace function public.mon_oracle_retirement_facts()
 returns table(platform text, strategy text, active bigint, asks bigint, affirmative bigint, unknown_asks bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with ev as (
    select split_part(p.source_table, '_', 1) as platform,
           count(*)                                              as asks,
           count(*) filter (where p.verdict in ('GONE','LIVE'))  as affirmative,
           count(*) filter (where p.verdict = 'UNKNOWN')         as unknown_asks
      from public.ops_stale_inactivation_probe p
     where p.oracle in ('prune_unseen.verify_gone',
                        'fleet_liveness.' || split_part(p.source_table, '_', 1))
     group by 1
  )
  select c.platform, c.strategy, c.active,
         coalesce(e.asks, 0), coalesce(e.affirmative, 0), coalesce(e.unknown_asks, 0)
    from public.ops_platform_liveness_coverage c
    left join ev e on e.platform = c.platform
   where c.strategy in ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT');
$function$;

create or replace function public.mon_oracle_never_retires(p_min_asks integer default 25)
 returns table(platform text, strategy text, active bigint, under_strike bigint, asks bigint, affirmative bigint, unknown_asks bigint, latest timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with ev as (
    select split_part(p.source_table, '_', 1) as platform,
           count(*)                                              as asks,
           count(*) filter (where p.verdict in ('GONE','LIVE'))  as affirmative,
           count(*) filter (where p.verdict = 'UNKNOWN')         as unknown_asks,
           max(p.probed_at)                                      as latest
      from public.ops_stale_inactivation_probe p
     where p.oracle in ('prune_unseen.verify_gone',
                        'fleet_liveness.' || split_part(p.source_table, '_', 1))
     group by 1
  )
  select c.platform, c.strategy, c.active, c.under_strike,
         e.asks, e.affirmative, e.unknown_asks, e.latest
    from public.ops_platform_liveness_coverage c
    join ev e on e.platform = c.platform
   where c.strategy in ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT')
     and c.active > 0
     and e.asks >= p_min_asks
     and e.affirmative = 0;
$function$;
