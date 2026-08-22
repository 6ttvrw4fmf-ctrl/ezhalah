-- The five barriers the owner asked for after the 2026-08-22 deep-fill timeouts (senior run #35).
--
-- WHAT ACTUALLY HAPPENED. aqar answers an UNRECOGNISED city slug with a nationwide feed instead of
-- a 404. Seven of the 95 catalog slugs carried the hamza spelling (أبها) where aqar serves plain
-- alif (ابها), so discover()'s `new_on_page == 0` early-stop — the thing that makes --pages 150
-- safe — could never fire for them. Each of those towns walked 150 pages x 49 categories:
--
--   * five shards killed at exactly 149.8 min (turabah, ras_tanura, ahad_rafidah, abu_arish,
--     ahad_al_masarihah); abha 129.9m and umluj 120.8m survived only just. All 7 of the slowest
--     shards were exactly the 7 broken slugs — the correlation is total.
--   * those cities got ZERO city-page coverage. Sampling Abha over 4 categories x 2 pages: aqar
--     publishes 162 listings, we held 84. 78 missing, 48% of one major city.
--
-- The slugs are fixed in the same PR, and discover() now stops a slice the moment the source
-- answers with a page that is not that city. These detectors are the net UNDER that fix: the defect
-- had no symptom anyone was watching. It was not red. It was slow, and slow is invisible.
--
-- Five conditions, five dedup keys, each independently clearable — so fixing one does not mask
-- another:
--   completion_rate         runs that never finished
--   runtime_budget          how close the slowest run is to the ceiling that kills it
--   discovery_regression    new listings found, against the trailing baseline
--   timeout_kills           runs killed by the job budget (exact, no inference)
--   silent_partial_success  a run that reported OK while recording that it lost coverage
--
-- The 150-minute ceiling is duplicated from .github/workflows/aqar-deep-fill.yml because SQL cannot
-- read the workflow. scripts/verify-aqar-city-slug-scope.ts fails if the two ever disagree.
--
-- NOTE: this version shipped with a NULL-blind `notes not like` filter in condition 3, corrected
-- minutes later by 20260822130456. Kept as applied — the history is the point.

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
     and notes like 'killed by SIGINT%';

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
     and notes not like 'killed by SIGINT%'
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
     and (notes like '%city_filter_ignored=%' or notes like '%killed by SIGINT%');

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

-- Roster wiring by the guarded needle-edit.
do $$
declare
  v_def text; v_before text;
  fn constant text := 'mon_detect_aqar_deep_fill_health';
  anchor constant text := '    ''mon_detect_cron_ordering_contract''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;
  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;
  if v_def <> v_before then execute v_def; end if;
end $$;

-- MUTATION PROOF against live data. The timeout-kill condition must fire RIGHT NOW, because five
-- real kills happened today — a barrier for an incident that cannot see the incident is decoration.
do $$
declare
  v_raised int;
  v_killed int;
  v_open_kill int;
begin
  select count(*) into v_killed
    from public.scrape_runs
   where platform='aqar_residential' and started_at > now() - interval '48 hours'
     and notes like 'killed by SIGINT%';
  if v_killed <> 5 then
    raise notice 'expected the 5 kills of 2026-08-22 in the 48h window, found % — threshold proof '
                 'will rely on whatever is there', v_killed;
  end if;

  v_raised := public.mon_detect_aqar_deep_fill_health();

  select count(*) into v_open_kill
    from public.alert_event
   where kind='aqar_deep_fill_health' and dedup_key='aqar_timeout_kills' and resolved_at is null;

  if v_killed > 0 and v_open_kill = 0 then
    raise exception 'BARRIER BLIND: % SIGINT kills in the window and no aqar_timeout_kills alert '
                    'is open', v_killed;
  end if;
  if v_killed = 0 and v_open_kill > 0 then
    raise exception 'BARRIER CRYING WOLF: no kills in the window but an alert is open';
  end if;
end $$;
