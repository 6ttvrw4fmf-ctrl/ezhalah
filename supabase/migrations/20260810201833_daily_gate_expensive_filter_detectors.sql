-- The five Filter-audit detectors cost 16.3 s together (price_size 6.4s · location 4.8s ·
-- trending 2.7s · commercial 2.2s · perf 0.25s) because they drive REAL RPC calls and regex whole
-- capture columns — that is exactly why they catch things a count comparison cannot. But
-- mon_run_all_detectors() runs twice an HOUR (jobid 38 at :29/:59), so leaving them ungated adds
-- ~13 minutes of database work per day competing with user searches. This instance has already been
-- taken down once by exactly that kind of self-inflicted load.
--
-- These classes are structural — a reverted predicate, a dropped index, a parser regression, a
-- residential-only barrier. They change on deploys, not minute to minute. Daily is the right cadence
-- and is what the routine asks for.
--
-- Gated on a LAST-RUN TABLE, deliberately not on `extract(hour from now()) = 5`: an hour gate looks
-- equivalent but fails silently and permanently the day someone reschedules jobid 38 away from that
-- hour, and a monitor that can never fire is worse than no monitor because it reads as "clean".
-- The interval-based gate self-heals under any schedule.
create table if not exists public.ops_detector_last_full_run(
  detector      text primary key,
  last_run_at   timestamptz not null default now(),
  last_result   int
);

comment on table public.ops_detector_last_full_run is
  'Daily-cadence gate for expensive behavioural detectors (2026-08-10). They drive real RPCs, so they '
  'run at most once per ~20h instead of on every 30-min sweep. Interval-based, not hour-based, so a '
  'cron reschedule cannot silently switch them off forever.';

-- Returns true AT MOST once per ~20h per detector, and claims the slot atomically so two concurrent
-- sweeps cannot both run the expensive body.
create or replace function public.mon_claim_daily_slot(p_detector text)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare v_claimed boolean;
begin
  insert into public.ops_detector_last_full_run(detector, last_run_at)
  values (p_detector, now())
  on conflict (detector) do update
    set last_run_at = now()
    where public.ops_detector_last_full_run.last_run_at < now() - interval '20 hours'
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end $function$;

-- Wrap each expensive body in the gate. Behaviour when it DOES run is unchanged.
create or replace function public.mon_detect_price_size_contamination()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; r record;
begin
  if not public.mon_claim_daily_slot('price_size_contamination') then return 0; end if;
  for r in select * from public.mon_price_size_fidelity_barrier() loop
    n := n + public.mon_raise(
      case when r.check_name in ('area_leaked_into_price','rate_stored_as_total',
                                 'index_price_differs_from_raw') then 'P1' else 'P2' end,
      'price_size_contamination', r.platform,
      'price_size_contamination:' || r.check_name || ':' || r.platform,
      jsonb_build_object('check', r.check_name, 'rows', r.n, 'detail', r.detail,
        'adjudicate', 'Equality/oddness is NOT proof. Check the spec table and price_per_meter '
                   || 'before touching anything: ppm=1 makes total=area legitimately (aqar 6594767), '
                   || 'and a source-published area may coincide with the rent. Only repair when the '
                   || 'source demonstrably publishes something else.'));
  end loop;
  update public.ops_detector_last_full_run set last_result = n
   where detector = 'price_size_contamination';
  return n;
end $function$;

create or replace function public.mon_detect_trending_district_dead_end()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; r record;
begin
  if not public.mon_claim_daily_slot('trending_district_dead_end') then return 0; end if;
  for r in select * from public.mon_trending_district_barrier() loop
    n := n + public.mon_raise(
      case when r.check_name = 'trending_chip_dead_end' then 'P1' else 'P2' end,
      'trending_district', 'all',
      'trending_district:' || r.check_name,
      jsonb_build_object('check', r.check_name, 'n', r.n, 'detail', r.detail,
        'note', 'The chip must deliver what it promises. Callers MUST pass match_values, not the '
             || 'display name — the display name loses the hamza twin (measured 1,869 -> 1,104).'));
  end loop;
  update public.ops_detector_last_full_run set last_result = n
   where detector = 'trending_district_dead_end';
  return n;
end $function$;

create or replace function public.mon_detect_location_predicate_drift()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; r record;
begin
  if not public.mon_claim_daily_slot('location_predicate_drift') then return 0; end if;
  for r in select * from public.mon_location_predicate_branch_barrier() loop
    n := n + public.mon_raise('P1', 'location_predicate_drift', 'all',
      'location_predicate_drift:' || r.probe_city || ':' || r.probe_deal,
      jsonb_build_object('city', r.probe_city, 'deal', r.probe_deal,
        'rpc_total', r.rpc_total, 'truth_total', r.truth_total, 'gap', r.gap,
        'note', 'A city match is city_ar text OR city_id OR match_city_ids overlap. Each branch '
             || 'holds listings the others miss. A gap means a branch was dropped — inventory is '
             || 'silently unreachable, not merely slower.'));
  end loop;
  update public.ops_detector_last_full_run set last_result = n
   where detector = 'location_predicate_drift';
  return n;
end $function$;

create or replace function public.mon_detect_search_performance_regression()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; t0 timestamptz; v_broad numeric; v_typical numeric;
begin
  if not public.mon_claim_daily_slot('search_performance_regression') then return 0; end if;
  t0 := clock_timestamp();
  perform 1 from public.location_search_candidates_ar(
    p_deal := 'بيع', p_cities := array['الرياض'], p_limit := 10);
  v_broad := extract(epoch from clock_timestamp() - t0) * 1000;

  t0 := clock_timestamp();
  perform 1 from public.location_search_candidates_ar(
    p_deal := 'بيع', p_cities := array['الرياض'], p_types := array['شقة'],
    p_price_min := 500000, p_price_max := 1500000, p_beds_exact := array[3], p_limit := 10);
  v_typical := extract(epoch from clock_timestamp() - t0) * 1000;

  if v_broad > 2000 or v_typical > 500 then
    n := public.mon_raise(case when v_broad > 5000 then 'P1' else 'P2' end,
      'search_performance_regression', 'all',
      'search_performance_regression:' || current_date,
      jsonb_build_object('broad_ms', round(v_broad), 'broad_baseline_ms', 255,
        'typical_ms', round(v_typical), 'typical_baseline_ms', 65,
        'first_check', 'EXPLAIN the broad query. It MUST show a BitmapOr over idx_slar_city_norm + '
                    || 'idx_slar_deal_city + idx_slar_match_city_ids. If it shows a hashed SubPlan '
                    || 'instead, the location predicate was reverted from = ANY (ARRAY(SELECT ...)) '
                    || 'to IN (SELECT ...), which makes those indexes unusable.',
        'rule', 'NEVER fix this by narrowing the predicate. Correctness outranks speed: any change '
             || 'must return byte-identical ordered results on the 12 audited query shapes.'));
  end if;
  update public.ops_detector_last_full_run set last_result = n
   where detector = 'search_performance_regression';
  return n;
end $function$;

create or replace function public.mon_detect_commercial_coverage_blind_spot()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; r record; v_active bigint; v_search bigint;
begin
  if not public.mon_claim_daily_slot('commercial_coverage_blind_spot') then return 0; end if;
  for r in
    select c.table_name
    from information_schema.tables c
    where c.table_schema = 'public' and c.table_name like '%\_commercial\_listings'
  loop
    execute format('select count(*) from public.%I where active', r.table_name) into v_active;
    select count(*) into v_search from public.search_listings_ar s where s.source_table = r.table_name;
    if v_active > 50 and v_search = 0 then
      n := n + public.mon_raise('P1', 'commercial_coverage_blind_spot',
        replace(r.table_name, '_commercial_listings', ''),
        'commercial_coverage_blind_spot:' || r.table_name,
        jsonb_build_object('table', r.table_name, 'active_rows', v_active, 'rows_in_search', v_search,
          'note', 'A whole commercial table holds active inventory but reaches search with nothing. '
               || 'Also re-check that every fidelity barrier spans BOTH the residential and the '
               || 'commercial table for this platform — a residential-only JOIN hides half a platform.'));
    end if;
  end loop;
  update public.ops_detector_last_full_run set last_result = n
   where detector = 'commercial_coverage_blind_spot';
  return n;
end $function$;

-- A gate that never opens is the failure mode this design exists to avoid, so it is itself watched:
-- if any gated detector has not completed a full run in 30h, that is a P2.
create or replace function public.mon_detect_stalled_daily_detector()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; stalled text[];
begin
  select coalesce(array_agg(detector order by detector), '{}') into stalled
  from public.ops_detector_last_full_run
  where last_run_at < now() - interval '30 hours';

  if cardinality(stalled) > 0 then
    n := public.mon_raise('P2', 'stalled_daily_detector', 'all',
      'stalled_daily_detector:' || array_to_string(stalled, ','),
      jsonb_build_object('stalled', to_jsonb(stalled),
        'note', 'A gated detector has not completed a full run in 30h. Either the detector sweep '
             || '(cron jobid 38) stopped, or the detector is erroring before it can record a run. '
             || 'A monitor that cannot fire reads as "clean" — treat this as an outage of that '
             || 'bug class, not as a low-priority nit.'));
  end if;
  return n;
end $function$;

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
  where n2.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if position('mon_detect_stalled_daily_detector' in v_def) > 0 then return; end if;
  if position('''mon_detect_orphaned_detectors''' in v_def) = 0 then
    raise exception 'roster anchor missing';
  end if;

  v_new := replace(v_def, '    ''mon_detect_orphaned_detectors''',
    '    ''mon_detect_stalled_daily_detector'','
    || E'\n    ''mon_detect_orphaned_detectors''');
  if v_new = v_def then raise exception 'roster needle-edit produced no change'; end if;
  execute v_new;
end $$;