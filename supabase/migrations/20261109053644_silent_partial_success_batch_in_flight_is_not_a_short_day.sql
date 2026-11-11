-- ⚡ Scraping Engineer 2026-11-09 (owner followup 3292, repeat_bug:silent_partial_success:wasalt_enum_shard, 4 reopens
-- in 7 days: alerts 12779, 12912, 13342, 13929, each raised at 22:59/23:59 UTC and self-resolved 1 h later).
-- Cause: the sliced-day total was judged while the enum batch (dispatched 21:00, ~40 shards) still had its three
-- ~30,000-row shards running (they end 00:30-01:16), so the day read 68,604 of ~166,700. Fix: a label with a
-- slice in flight (ok is null, started < 6 h ago) is not judged on its day yet. Same signature, no DROP; the
-- definition is 20261103233814's with that one clause, and the check block gains case (g), wasalt's exact shape,
-- which must stay quiet while (a) the enum collapse and (c) the single-run shortfall must still fire.
create or replace function public.mon_silent_partial_success_candidates(p_runs jsonb default null)
returns table(platform text, worst numeric, short_runs bigint, median_rows numeric, mode text)
language sql stable
set search_path to 'public'
as $function$
  with runs as (
    select s.platform, s.started_at, s.ok, s.rows_seen
      from public.scrape_runs s
     where p_runs is null and s.started_at >= now() - interval '18 days'
    union all
    select x.platform, x.started_at, x.ok, x.rows_seen
      from jsonb_to_recordset(coalesce(p_runs, '[]'::jsonb))
           as x(platform text, started_at timestamptz, ok boolean, rows_seen int)
     where p_runs is not null
  ), cap as (
    select r.platform, r.started_at, r.rows_seen,
           floor(extract(epoch from (now() - r.started_at)) / 86400)::int as day_ago,
           -- bday: the label's day counted back from its OWN latest run, so a once-a-day batch that is
           -- still running (or ran a few minutes later than yesterday) is never split across two days.
           floor(extract(epoch from (max(r.started_at) over (partition by r.platform) - r.started_at)) / 86400)::int as bday
      from runs r
      left join public.ops_platform_catalogue_rebase cr on cr.platform = r.platform
     where r.ok is true and r.rows_seen > 0
       and r.started_at >= now() - interval '18 days'
       and r.platform not like '%liveness%'
       and r.platform not like 'cleanup:%'
       -- an enrichment label's rows_seen is its PENDING QUEUE (wasalt_enrich_ar_*: 3,436 during the 11-01
       -- backfill, 99 on a normal night), never a captured catalogue, and it never feeds prune_unseen().
       and r.platform not like '%\_enrich\_%'
       -- a platform whose readable catalogue changed shape on purpose is judged only from that moment
       -- (ops_platform_catalogue_rebase: superoffice, robots.txt, owner 2026-11-03)
       and (cr.rebased_at is null or r.started_at >= cr.rebased_at)
  ), daily as (
    select c.platform, c.bday, sum(c.rows_seen)::numeric as total, count(*) as runs
      from cap c group by c.platform, c.bday
  ), base_day as (
    select d.platform,
           percentile_cont(0.25) within group (order by d.total)::numeric as p25_total,
           percentile_cont(0.5) within group (order by d.runs) as median_runs
      from daily d where d.bday >= 1
     group by d.platform having count(*) >= 5
  ), base_run as (
    select c.platform, percentile_cont(0.5) within group (order by c.rows_seen)::numeric as median_rows
      from cap c where c.day_ago >= 1
     group by c.platform having count(*) >= 5
  ), sliced as (
    select d.platform, d.total as worst, d.runs as short_runs, b.p25_total as median_rows, 'sliced_day_total'::text as mode
      from daily d join base_day b on b.platform = d.platform
     where d.bday = 0 and b.median_runs >= 3
       and d.total < 0.50 * b.p25_total
       -- ⚡ 2026-11-09: a batch with a slice still IN FLIGHT (ok is null, started < 6 h ago) has no day total yet.
       -- wasalt_enum_shard's biggest shards (~30,000 rows) finish 00:30-01:16 UTC, so the 22:59/23:59 sweeps read
       -- the finished half (68,604 of ~166,700) and raised a P1 four nights in seven. A shard that dies is judged
       -- at most 6 h later, never hidden.
       and not exists (select 1 from runs f where f.platform = d.platform and f.ok is null
                         and f.started_at > now() - interval '6 hours')
  ), single as (
    select c.platform, min(c.rows_seen)::numeric as worst, count(*) as short_runs, br.median_rows, 'per_run'::text as mode
      from cap c join base_run br on br.platform = c.platform
     where c.day_ago = 0
       and c.rows_seen < 0.50 * br.median_rows
       and not exists (select 1 from base_day b where b.platform = c.platform and b.median_runs >= 3)
     group by c.platform, br.median_rows
  ), declared as (
    -- a rebased platform is held to its DECLARED size from its first run, before it has a median
    select c.platform, min(c.rows_seen)::numeric as worst, count(*) as short_runs,
           cr.expected_rows_per_run::numeric as median_rows, 'declared_catalogue'::text as mode
      from cap c join public.ops_platform_catalogue_rebase cr on cr.platform = c.platform
     where c.day_ago = 0
       and c.rows_seen < 0.50 * cr.expected_rows_per_run
       and not exists (select 1 from sliced s where s.platform = c.platform)
       and not exists (select 1 from single s where s.platform = c.platform)
     group by c.platform, cr.expected_rows_per_run
  )
  select * from sliced
  union all
  select * from single
  union all
  select * from declared
$function$;

-- Check block: both directions, on synthetic runs (nothing is written).
do $check$
declare j jsonb; hits text[];
begin
  select jsonb_agg(x) into j from (
    -- (a) the wasalt-enum collapse: 34 shards a day of ~5,000 rows for 17 days, today 34 shards of ~3 → MUST fire
    select '__chk_enum'::text as platform, now() - (d || ' days')::interval - (s || ' minutes')::interval as started_at,
           true as ok, case when d = 0 then 3 else 5000 end as rows_seen
      from generate_series(0, 16) d, generate_series(1, 34) s
    union all
    -- (b) a sliced crawler with uneven slices (1..300) and a normal day → must NOT fire
    select '__chk_slices', now() - (d || ' days')::interval - (s || ' minutes')::interval, true, 1 + (s * 37 % 300)
      from generate_series(0, 16) d, generate_series(1, 34) s
    union all
    -- (c) a once-a-day crawler that read 40 instead of ~1,000 → MUST fire (per-run path unchanged)
    select '__chk_single', now() - (d || ' days')::interval - interval '5 minutes', true, case when d = 0 then 40 else 1000 end
      from generate_series(0, 16) d
    union all
    -- (e) gathern's shape (⚡ 2026-11-03, alert 12814): ONE batch of 12 slices a day, today's batch still
    -- running (2 slices so far) and yesterday's batch a few minutes later than today's. A rolling now()-24h
    -- window split it (5,200 of 15,600) → must NOT fire
    select '__chk_batch', now() - (d || ' days')::interval - interval '16 minutes' + ((s - 1) * 2 || ' minutes')::interval,
           true, 1300
      from generate_series(1, 16) d, generate_series(1, 12) s
    union all
    select '__chk_batch', now() - (m || ' minutes')::interval, true, 650 from generate_series(15, 16) m
    union all
    -- (f) an enrichment queue that drained (3,436 → 99, wasalt_enrich_ar_residential 11-01/11-02) → must NOT fire
    select 'wasalt_enrich_ar___chk', now() - (d || ' days')::interval - interval '5 minutes', true, case when d = 0 then 99 else 3436 end
      from generate_series(0, 16) d
    union all
    -- (g) wasalt_enum_shard's shape (⚡ 2026-11-09, alerts 12779/12912/13342/13929): 10 shards a day of 15,000;
    -- tonight 5 finished small shards and 3 still running (ok null, rows 0) → must NOT fire until they end
    select '__chk_inflight', now() - (d || ' days')::interval - interval '210 minutes' + (s || ' minutes')::interval,
           true, 15000
      from generate_series(1, 16) d, generate_series(1, 10) s
    union all
    select '__chk_inflight', now() - interval '180 minutes' + (s || ' minutes')::interval, true, 2000
      from generate_series(1, 5) s
    union all
    select '__chk_inflight', now() - interval '120 minutes' + (s || ' minutes')::interval, null::boolean, 0
      from generate_series(1, 3) s
    union all
    -- (d) a liveness label probing few rows → must NOT fire (rows_seen is probes, not a capture)
    select 'fleet_liveness:__chk', now() - (d || ' days')::interval - interval '5 minutes', true, case when d = 0 then 1 else 4000 end
      from generate_series(0, 16) d
  ) x;
  select array_agg(platform order by platform) into hits from public.mon_silent_partial_success_candidates(j);
  if hits is distinct from array['__chk_enum', '__chk_single'] then
    raise exception 'silent_partial_success check failed: candidates = %', hits;
  end if;
end $check$;