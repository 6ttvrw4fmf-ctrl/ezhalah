-- My own barrier had the bug I spent today fixing in other people's: a NULL-blind NOT LIKE.
--
-- mon_detect_aqar_deep_fill_health()'s runtime-budget condition excluded killed runs with
--     and notes not like 'killed by SIGINT%'
-- and `NULL not like '...'` is NULL, not TRUE. A healthy aqar run leaves notes NULL, so the filter
-- silently dropped every healthy run: it saw 93 of 2,571 runs in the 8-day window — 96% invisible,
-- including the one that mattered. The slowest COMPLETED run on 2026-08-22 is 129.8 minutes, which
-- is 86.5% of the 150-minute ceiling and comfortably over the 60% threshold, and the barrier said
-- nothing. Caught by asking why it stayed silent on a run I already knew about, not by re-reading
-- the SQL.
--
-- Every notes predicate in the function is made NULL-safe, not just the one that bit — the same
-- mistake was one keystroke away in the other three.

create or replace function public.mon_detect_aqar_deep_fill_health()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  -- keep in lockstep with .github/workflows/aqar-deep-fill.yml `timeout-minutes:`
  c_ceiling_min   constant numeric := 150;
  c_near_frac     constant numeric := 0.60;   -- warn once the slowest run passes 60% of the ceiling
  c_min_completion constant numeric := 0.95;
  n int := 0;
  v_runs int; v_unfinished int; v_killed int; v_completion numeric;
  v_max_min numeric; v_pct numeric;
  v_silent int; v_silent_sample text;
  v_recent bigint; v_baseline numeric;
begin
  ---------------------------------------------------------------- 1. timeout kills (exact)
  select count(*) into v_killed
    from public.scrape_runs
   where platform = 'aqar_residential'
     and started_at > now() - interval '48 hours'
     and coalesce(notes,'') like 'killed by SIGINT%';

  if v_killed > 0 then
    n := n + public.mon_raise('P1','aqar_deep_fill_health','aqar','aqar_timeout_kills',
      jsonb_build_object('killed_48h', v_killed, 'ceiling_min', c_ceiling_min,
        'why','aqar_residential runs were killed by the CI job budget. Rows upserted before the '
           ||'kill are kept, but prune/liveness and the run''s own bookkeeping never ran, so that '
           ||'slice is silently incomplete.',
        'action','Find WHY the slice ran long before widening the budget. On 2026-08-22 the answer '
           ||'was a wrong city slug making the crawl nationwide and unbounded — not workload.'));
  else
    perform public.mon_resolve_key('aqar_deep_fill_health','aqar_timeout_kills');
  end if;

  ---------------------------------------------------------------- 2. completion rate
  select count(*), count(*) filter (where finished_at is null)
    into v_runs, v_unfinished
    from public.scrape_runs
   where platform = 'aqar_residential' and started_at > now() - interval '24 hours'
     and started_at < now() - interval '30 minutes';       -- ignore runs still legitimately going

  v_completion := case when v_runs > 0
                       then (v_runs - v_unfinished - v_killed)::numeric / v_runs else 1 end;
  if v_runs >= 20 and v_completion < c_min_completion then
    n := n + public.mon_raise('P2','aqar_deep_fill_health','aqar','aqar_completion_rate',
      jsonb_build_object('runs_24h', v_runs, 'unfinished', v_unfinished, 'killed', v_killed,
        'completion', round(v_completion,4), 'floor', c_min_completion,
        'why','too many aqar_residential runs did not finish. A run that never reaches end_run() '
           ||'leaves no bookkeeping, so its slice is unverifiable.'));
  else
    perform public.mon_resolve_key('aqar_deep_fill_health','aqar_completion_rate');
  end if;

  ---------------------------------------------------------------- 3. runtime budget utilisation
  select round(max(extract(epoch from finished_at - started_at))/60.0, 1) into v_max_min
    from public.scrape_runs
   where platform = 'aqar_residential' and started_at > now() - interval '8 days'
     and finished_at is not null
     -- coalesce(notes,'') — a healthy run leaves notes NULL, and `NULL not like ...` is NULL,
     -- which silently excluded 96% of runs (see this migration's header).
     and coalesce(notes,'') not like 'killed by SIGINT%'
     -- a dangling row reconciled hours later is bookkeeping, not runtime
     and extract(epoch from finished_at - started_at)/60.0 <= c_ceiling_min;

  v_pct := case when v_max_min is null then 0 else round(100*v_max_min/c_ceiling_min,1) end;
  if v_max_min is not null and v_max_min > c_near_frac * c_ceiling_min then
    n := n + public.mon_raise('P2','aqar_deep_fill_health','aqar','aqar_runtime_budget',
      jsonb_build_object('slowest_completed_min', v_max_min, 'ceiling_min', c_ceiling_min,
        'pct_of_budget', v_pct,
        'why','the slowest aqar_residential run is approaching the CI job budget that kills it. A '
           ||'killed run keeps its rows but skips prune/liveness, so this is a warning BEFORE the '
           ||'coverage loss, not after.',
        'action','attribute the runtime first. Widen the budget only once the work is proven '
           ||'legitimate.'));
  else
    perform public.mon_resolve_key('aqar_deep_fill_health','aqar_runtime_budget');
  end if;

  ---------------------------------------------------------------- 4. silent partial success
  -- A run that reported OK while its own notes record that it lost coverage. This is the shape the
  -- 2026-08-22 defect wore: nothing was red, the job was merely slow.
  select count(*), coalesce(string_agg(distinct left(notes,120), ' ~ '), '')
    into v_silent, v_silent_sample
    from public.scrape_runs
   where platform = 'aqar_residential'
     and started_at > now() - interval '48 hours'
     and ok is true
     and (coalesce(notes,'') like '%city_filter_ignored=%' or coalesce(notes,'') like '%killed by SIGINT%');

  if v_silent > 0 then
    n := n + public.mon_raise('P1','aqar_deep_fill_health','aqar','aqar_silent_partial_success',
      jsonb_build_object('runs', v_silent, 'sample', left(v_silent_sample, 600),
        'why','a run reported ok=true while recording that it lost coverage — either aqar served a '
           ||'nationwide feed instead of the city we asked for (our slug is wrong, so that city '
           ||'gets NOTHING), or the job was killed. Green plus lost coverage is the worst state: '
           ||'nobody looks.',
        'action','for city_filter_ignored, fix the slug in scrapers/aqar/discover.py CITY_AR and '
           ||'confirm against the live city page.'));
  else
    perform public.mon_resolve_key('aqar_deep_fill_health','aqar_silent_partial_success');
  end if;

  ---------------------------------------------------------------- 5. discovery regression
  -- New aqar listings that reached the searchable index in the last 24h, against the trailing
  -- 7-day median. Deliberately median, not mean: the weekly deep-fill is a legitimate spike and
  -- must not set the expectation for ordinary days.
  select count(*) into v_recent
    from public.search_listings_ar
   where source_table like 'aqar%' and first_seen_at > now() - interval '24 hours';

  select percentile_cont(0.5) within group (order by c) into v_baseline
    from (select count(*) c
            from public.search_listings_ar
           where source_table like 'aqar%'
             and first_seen_at > now() - interval '8 days'
             and first_seen_at <= now() - interval '24 hours'
           group by date_trunc('day', first_seen_at)) d;

  if v_baseline is not null and v_baseline >= 50 and v_recent < 0.4 * v_baseline then
    n := n + public.mon_raise('P2','aqar_deep_fill_health','aqar','aqar_discovery_regression',
      jsonb_build_object('new_24h', v_recent, 'baseline_median_7d', round(v_baseline),
        'ratio', round(v_recent / nullif(v_baseline,0), 3),
        'why','aqar discovery has dropped well below its own trailing baseline. A crawl can look '
           ||'healthy and still stop FINDING things — a wrong city slug, a pagination change or a '
           ||'coverage cap all present this way.'));
  else
    perform public.mon_resolve_key('aqar_deep_fill_health','aqar_discovery_regression');
  end if;

  return n;
end
$function$;


-- MUTATION PROOF, tightened: the runtime-budget condition must SEE today's 129.8-minute run.
do $$
declare
  v_visible int; v_max numeric; v_open int;
begin
  select count(*), round(max(extract(epoch from finished_at-started_at))/60.0,1)
    into v_visible, v_max
    from public.scrape_runs
   where platform='aqar_residential' and started_at > now() - interval '8 days'
     and finished_at is not null
     and coalesce(notes,'') not like 'killed by SIGINT%'
     and extract(epoch from finished_at-started_at)/60.0 <= 150;

  if v_visible < 1000 then
    raise exception 'runtime-budget filter still blind: only % runs visible in 8 days', v_visible;
  end if;

  perform public.mon_detect_aqar_deep_fill_health();

  select count(*) into v_open from public.alert_event
   where kind='aqar_deep_fill_health' and dedup_key='aqar_runtime_budget' and resolved_at is null;

  if v_max > 90 and v_open = 0 then
    raise exception 'BARRIER BLIND: slowest completed run is % min and no aqar_runtime_budget '
                    'alert is open', v_max;
  end if;
end $$;
