-- silent_partial_success: judge a SLICED crawler by its day, not by one slice (backlog 449, 2026-10-13).
--
-- The detector compared every run of a label with ONE 18-day per-run median. Sliced crawlers write one
-- run per slice (wasalt ~34 page slices a day, aqar ~200-500 city/type slices, gathern 12 city shards),
-- so any small slice read as a «short» run: standing P1s on wasalt, aqar_residential, aqar_commercial and
-- gathern while their daily totals were normal (10-13: gathern 9,797 vs 9,410 median, aqar_commercial
-- 21,660 vs 20,227). Liveness and cleanup labels were judged too, though their rows_seen counts probes
-- or candidates (fleet_liveness skips rows verified recently: tuba probed 0..3,915 of 3,915), never a
-- captured catalogue that prune_unseen acts on.
--
-- Now:
--  * labels whose rows_seen is not a capture are out: '%liveness%' and 'cleanup:%';
--  * a label that runs >= 3 times on a median day is SLICED: its last-24h TOTAL is compared with the 25th
--    percentile of its earlier 24h totals (wasalt alternates ~2.4k and ~180k days; p25 keeps the small day
--    as the floor);
--  * every other label keeps the per-run comparison unchanged.
-- The candidate set is one function (mon_silent_partial_success_candidates) that can also read synthetic
-- runs, so the check block below proves both directions without touching scrape_runs.

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
           floor(extract(epoch from (now() - r.started_at)) / 86400)::int as day_ago
      from runs r
     where r.ok is true and r.rows_seen > 0
       and r.started_at >= now() - interval '18 days'
       and r.platform not like '%liveness%'
       and r.platform not like 'cleanup:%'
  ), daily as (
    select c.platform, c.day_ago, sum(c.rows_seen)::numeric as total, count(*) as runs
      from cap c group by c.platform, c.day_ago
  ), base_day as (
    select d.platform,
           percentile_cont(0.25) within group (order by d.total)::numeric as p25_total,
           percentile_cont(0.5) within group (order by d.runs) as median_runs
      from daily d where d.day_ago >= 1
     group by d.platform having count(*) >= 5
  ), base_run as (
    select c.platform, percentile_cont(0.5) within group (order by c.rows_seen)::numeric as median_rows
      from cap c where c.day_ago >= 1
     group by c.platform having count(*) >= 5
  ), sliced as (
    select d.platform, d.total as worst, d.runs as short_runs, b.p25_total as median_rows, 'sliced_day_total'::text as mode
      from daily d join base_day b on b.platform = d.platform
     where d.day_ago = 0 and b.median_runs >= 3
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

create or replace function public.mon_detect_silent_partial_success()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; live text[] := '{}'; r record;
begin
  for r in
    select * from public.mon_silent_partial_success_candidates()
     order by worst / nullif(median_rows, 0)
  loop
    live := live || ('silent_partial_success:' || r.platform);
    n := n + public.mon_raise('P1', 'silent_partial_success', r.platform,
      'silent_partial_success:' || r.platform,
      jsonb_build_object('worst_rows_seen_24h', r.worst, 'short_runs_24h', r.short_runs,
        'baseline_median_rows', r.median_rows, 'mode', r.mode,
        'why', 'a run REPORTED SUCCESS while capturing far fewer rows than this platform normally '
            || 'does. This is the most dangerous shape in the system: ok=true suppresses every '
            || 'failure barrier, and the short list is then handed to prune_unseen(), which '
            || 'inactivates the listings that simply were not captured. For a sliced crawler '
            || '(mode sliced_day_total) the last 24h total is below half its usual smallest day.',
        'adjudicate', 'Find where the capture stopped early - a truncated sitemap/stream, a '
            || 'pagination cut-off, or an enumeration that gave up mid-way. A scraper must treat '
            || 'an unprovable/partial catalogue as a FAILED attempt, never as a small catalogue. '
            || 'Verify no inactivation ran off this run before anything else.'));
  end loop;
  perform public.mon_resolve_stale_keys('silent_partial_success', live);
  return n;
end $function$;

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
    -- (d) a liveness label probing few rows → must NOT fire (rows_seen is probes, not a capture)
    select 'fleet_liveness:__chk', now() - (d || ' days')::interval - interval '5 minutes', true, case when d = 0 then 1 else 4000 end
      from generate_series(0, 16) d
  ) x;
  select array_agg(platform order by platform) into hits from public.mon_silent_partial_success_candidates(j);
  if hits is distinct from array['__chk_enum', '__chk_single'] then
    raise exception 'silent_partial_success check failed: candidates = %', hits;
  end if;
end $check$;
