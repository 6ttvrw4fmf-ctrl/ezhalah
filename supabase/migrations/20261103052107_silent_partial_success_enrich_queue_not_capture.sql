-- silent_partial_success: an ENRICHMENT queue is not a capture (⚡ Scraping Engineer 2026-11-03, alert 12600).
--
-- wasalt_enrich_ar_residential raised P1 «99 rows vs a 3,436 median». Its rows_seen is the number of rows
-- WAITING for enrichment (notes: ok=99 empty=0 fail=0), which was large during the 11-01 backfill
-- (allow_backfill=True) and small once the queue drained; the label never calls prune_unseen(). Same class as
-- the '%liveness%' and 'cleanup:%' labels already left out (rows_seen = probes / candidates). Everything from
-- 20261103051511 is kept; the check block gains case (f), which must stay quiet.
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
     where r.ok is true and r.rows_seen > 0
       and r.started_at >= now() - interval '18 days'
       and r.platform not like '%liveness%'
       and r.platform not like 'cleanup:%'
       -- an enrichment label's rows_seen is its PENDING QUEUE (wasalt_enrich_ar_*: 3,436 during the 11-01
       -- backfill, 99 on a normal night), never a captured catalogue, and it never feeds prune_unseen().
       and r.platform not like '%\_enrich\_%'
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
  ), single as (
    select c.platform, min(c.rows_seen)::numeric as worst, count(*) as short_runs, br.median_rows, 'per_run'::text as mode
      from cap c join base_run br on br.platform = c.platform
     where c.day_ago = 0
       and c.rows_seen < 0.50 * br.median_rows
       and not exists (select 1 from base_day b where b.platform = c.platform and b.median_runs >= 3)
     group by c.platform, br.median_rows
  )
  select * from sliced
  union all
  select * from single
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
    -- (d) a liveness label probing few rows → must NOT fire (rows_seen is probes, not a capture)
    select 'fleet_liveness:__chk', now() - (d || ' days')::interval - interval '5 minutes', true, case when d = 0 then 1 else 4000 end
      from generate_series(0, 16) d
  ) x;
  select array_agg(platform order by platform) into hits from public.mon_silent_partial_success_candidates(j);
  if hits is distinct from array['__chk_enum', '__chk_single'] then
    raise exception 'silent_partial_success check failed: candidates = %', hits;
  end if;
end $check$;