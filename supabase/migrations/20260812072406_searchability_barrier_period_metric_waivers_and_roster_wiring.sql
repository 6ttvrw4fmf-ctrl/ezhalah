-- Searchability barrier: measure period-reachability honestly, respect recorded source silence,
-- and WIRE IT — the view has never raised an alert because nothing ever read it.
--
-- THREE DEFECTS, all found by the 2026-08-12 Data Integrity run:
--
-- 1. NOTHING CALLED IT. `mon_searchability_alerts` computes a per-platform verdict
--    (SEARCHABILITY_COLLAPSE / DROP / NEW_ROWS_STUCK_BEFORE_SEARCH / PRODUCTION_READY_FELL), and no
--    pg_proc body and no cron job referenced it. cron job 62 faithfully snapshots the HISTORY the
--    verdict is built from, twice-hourly detectors never look at the verdict. Same class as §11a
--    (orphaned detector) and §22 (rent_period_missing_on_priced_rent sat in a MANUAL barrier for
--    weeks): a barrier nothing calls is decoration. Today it carried 7 COLLAPSE verdicts and had
--    raised exactly zero alerts.
--
-- 2. THE HEADLINE METRIC COUNTED ONLY ANNUAL. `pct_annual_searchable` divides rows reachable under
--    the «سنوي» chip by all held rent rows — so a «شهري» row, which the monthly branch of the Filter
--    reaches perfectly well, counted as UNSEARCHABLE. Measured today: mustqr 21.6% -> 98.0%,
--    gathern 0.0% -> 99.7%, aqarmonthly 0.0% -> 99.3%, dealapp 86.5% -> 97.7%, aqarcity 78.2% ->
--    99.6%, eastabha 22.6% -> 64.2%. Any platform legitimately shifting annual->monthly read as a
--    collapse. §19: the measurement was the defect, not the data.
--
-- 3. IT DID NOT KNOW ABOUT `ops_rent_period_sourceless`. The 2026-08-11 audit removed the
--    fabricated «سنوي» default from 15 platforms whose sources publish no period, and recorded that
--    finding with evidence. `mon_detect_rent_period_unreachable()` honours that table; this view did
--    not, so an honest NULL the owner's own audit blessed read as SEARCHABILITY_COLLAPSE. Wiring the
--    verdict as-is would have raised 7 false P2s on day one.
--
-- WHAT THIS DOES NOT DO: it does not re-raise the period-suspect cohort. Priced rent rows with no
-- usable period are already owned by `mon_detect_rent_period_unreachable` (open P2 #423: aqar 79,
-- aqaratikom 7, october 1). Two detectors alerting on one cohort is how a roster becomes noise, so
-- SUSPECT_PRICE_WITHOUT_PERIOD stays in the view for diagnosis and never raises here.
--
-- SCOPE, STATED HONESTLY (§20): `mon_searchability_now` is scoped to deal='إيجار' AND
-- type_ar='شقة'. It is a rent-APARTMENT canary, not whole-platform coverage. That scope is
-- deliberately unchanged here — the 14-day baselines in mon_searchability_history are built on it,
-- and silently widening it would invalidate every baseline it compares against. Recorded as a
-- COMMENT so no future reader mistakes this for full coverage (run #12's lesson: a detector looking
-- at the wrong scope while returning 0 is the worst failure mode there is).

-- ── 1. history gains the corrected numerator ────────────────────────────────────────────────────
alter table public.mon_searchability_history
  add column if not exists searchable_by_period bigint;

comment on column public.mon_searchability_history.searchable_by_period is
  'Rows reachable under EITHER Filter period chip (سنوي or شهري) and production_ready. NULL for rows '
  'captured before 2026-08-12, when only the annual count was stored; readers must '
  'coalesce(searchable_by_period, searchable_annual). That fallback is safe in one direction only: '
  'annual is a SUBSET of by-period, so an old baseline can understate the past but can never '
  'manufacture a collapse that did not happen.';

-- ── 2. the live view: keep every existing column/position (CREATE OR REPLACE appends only) ───────
create or replace view public.mon_searchability_now as
  select platform,
    count(*) as held,
    count(*) filter (where rent_period_ar = 'سنوي' and production_ready) as searchable_annual,
    round(100.0 * count(*) filter (where rent_period_ar = 'سنوي' and production_ready)::numeric
          / nullif(count(*), 0)::numeric, 1) as pct_annual_searchable,
    count(*) filter (where rent_period_ar = 'شهري') as monthly_by_source,
    count(*) filter (where rent_period_ar is null) as period_unknown,
    count(*) filter (where rent_period_ar is null and price_annual is null and price_total is null)
      as correctly_withheld_no_source_data,
    count(*) filter (where rent_period_ar is null and (price_annual is not null or price_total is not null))
      as suspect_price_without_period,
    count(*) filter (where not production_ready) as blocked_not_production_ready,
    count(*) filter (where last_updated > now() - interval '48 hours') as new_last_48h,
    -- appended 2026-08-12
    count(*) filter (where rent_period_ar in ('سنوي','شهري') and production_ready) as searchable_by_period,
    round(100.0 * count(*) filter (where rent_period_ar in ('سنوي','شهري') and production_ready)::numeric
          / nullif(count(*), 0)::numeric, 1) as pct_period_searchable,
    (platform in (select platform from public.ops_rent_period_sourceless)) as period_waived
  from public.search_listings_ar
  where deal_ar = 'إيجار' and type_ar = 'شقة'
  group by platform;

comment on view public.mon_searchability_now is
  'Rent-APARTMENT searchability canary (deal=إيجار AND type_ar=شقة) — NOT whole-platform coverage. '
  'Use pct_period_searchable, not pct_annual_searchable: a «شهري» row is reachable under the monthly '
  'chip, so counting only «سنوي» understates reachability (gathern/aqarmonthly read 0.0% while '
  'being ~99% reachable). period_waived reflects ops_rent_period_sourceless — a platform whose '
  'source publishes no period at all, verified 2026-08-11.';

-- ── 3. snapshot records the corrected numerator too ─────────────────────────────────────────────
create or replace function public.mon_snapshot_searchability()
returns bigint
language sql
as $function$
  with ins as (
    insert into mon_searchability_history
      (platform, held, searchable_annual, period_unknown, no_price_no_period,
       price_but_no_period, not_production_ready, searchable_by_period)
    select platform, held, searchable_annual, period_unknown,
           correctly_withheld_no_source_data, suspect_price_without_period,
           blocked_not_production_ready, searchable_by_period
    from mon_searchability_now
    on conflict do nothing
    returning 1
  ) select count(*) from ins;
$function$;

-- ── 4. the verdict, rebuilt on the corrected metric and the waiver table ────────────────────────
drop view if exists public.mon_searchability_alerts;
create view public.mon_searchability_alerts as
  with now_ as (select * from public.mon_searchability_now),
  base as (
    select platform,
      percentile_cont(0.5) within group (
        order by (100.0 * coalesce(searchable_by_period, searchable_annual)::numeric
                  / nullif(held, 0)::numeric)::double precision)::numeric as baseline_pct,
      percentile_cont(0.5) within group (order by held::double precision)::numeric as baseline_held,
      count(*) as samples
    from public.mon_searchability_history
    where captured_at > now() - interval '14 days'
      and captured_at < date_trunc('day', now())
    group by platform
  )
  select n.platform,
    n.held,
    n.searchable_by_period,
    n.pct_period_searchable,
    round(b.baseline_pct, 1) as baseline_pct,
    round(b.baseline_held, 0) as baseline_held,
    coalesce(b.samples, 0) as baseline_samples,
    n.period_waived,
    n.suspect_price_without_period,
    n.correctly_withheld_no_source_data,
    n.blocked_not_production_ready,
    case
      -- Period-driven verdicts NEVER fire on a platform whose source publishes no period at all.
      when not n.period_waived and coalesce(b.samples, 0) >= 3 and b.baseline_pct >= 50
           and n.pct_period_searchable < b.baseline_pct * 0.5
        then 'SEARCHABILITY_COLLAPSE'
      when not n.period_waived and coalesce(b.samples, 0) >= 3 and b.baseline_pct >= 50
           and n.pct_period_searchable < b.baseline_pct - 15
        then 'SEARCHABILITY_DROP'
      -- These two are not about periods, so they apply to every platform, waived or not.
      when coalesce(b.samples, 0) >= 3 and n.held >= 20
           and n.held::numeric > b.baseline_held * 1.20
           and n.searchable_by_period::numeric <= b.baseline_held
        then 'NEW_ROWS_STUCK_BEFORE_SEARCH'
      when n.held >= 20 and n.blocked_not_production_ready::numeric >= n.held::numeric * 0.20
        then 'PRODUCTION_READY_FELL'
      else 'OK'
    end as verdict
  from now_ n left join base b on b.platform = n.platform;

comment on view public.mon_searchability_alerts is
  'Per-platform rent-apartment searchability verdict, read by mon_detect_searchability_collapse(). '
  'Built on pct_period_searchable (annual OR monthly). Period-driven verdicts are suppressed for '
  'platforms in ops_rent_period_sourceless. suspect_price_without_period is reported for diagnosis '
  'but deliberately raises NOTHING here — that cohort belongs to mon_detect_rent_period_unreachable.';

-- ── 5. the detector that finally reads it ──────────────────────────────────────────────────────
create or replace function public.mon_detect_searchability_collapse()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  r record;
  seen text[] := array[]::text[];
begin
  for r in
    select * from public.mon_searchability_alerts
    where verdict <> 'OK'
    order by held desc
  loop
    seen := seen || r.platform;
    n := n + public.mon_raise(
      case when r.verdict = 'SEARCHABILITY_COLLAPSE' then 'P1' else 'P2' end,
      'searchability_collapse', r.platform,
      'searchability_collapse:' || r.platform,
      jsonb_build_object(
        'verdict', r.verdict,
        'held', r.held,
        'searchable_by_period', r.searchable_by_period,
        'pct_period_searchable', r.pct_period_searchable,
        'baseline_pct', r.baseline_pct,
        'baseline_samples', r.baseline_samples,
        'blocked_not_production_ready', r.blocked_not_production_ready,
        'period_waived', r.period_waived,
        'why', 'Rent APARTMENT searchability for this platform fell against its own 14-day '
               'baseline. pct_period_searchable counts rows reachable under EITHER period chip, so '
               'this is not an annual/monthly mix shift. Do NOT "fix" it by defaulting a rent '
               'period — that fabricates a source fact (§22). Find what stopped resolving: the '
               'scraper''s period field, production_ready, or the location resolver.'));
  end loop;

  -- Self-heal every platform that is currently fine.
  perform public.mon_resolve_key('searchability_collapse', 'searchability_collapse:' || platform)
    from public.mon_searchability_alerts
    where verdict = 'OK' and not (platform = any(seen));

  return n;
end $function$;

comment on function public.mon_detect_searchability_collapse() is
  'Wired 2026-08-12 (Data Integrity run #14). The view it reads existed and NOTHING called it — no '
  'pg_proc body, no cron job — so 7 standing COLLAPSE verdicts had never raised one alert. Two '
  'measurement defects were fixed in the same migration: the metric counted only «سنوي» (so '
  'monthly-only platforms read 0%), and it ignored ops_rent_period_sourceless (so evidence-backed '
  'source silence read as a defect). Does not raise on suspect_price_without_period — that cohort '
  'is mon_detect_rent_period_unreachable''s.';

-- ── 6. roster wiring — needle-edit, never a hand-pasted body ────────────────────────────────────
-- The roster entry MUST land in this same migration: mon_detect_orphaned_detectors() fires on any
-- mon_detect_* nothing reaches, and an unwired barrier is decoration (§11a). The needle-edit reads
-- the LIVE body and splices one name in, so it cannot drop entries it never read — the failure that
-- cost this roster its detectors at least four times (guarded by
-- scripts/verify-detector-roster-edits-are-guarded.ts).
do $$
declare
  v_def text;
  v_before text;
  fn constant text := 'mon_detect_searchability_collapse';
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

  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;

  if v_def = v_before then
    raise notice 'roster already carries %', fn;
    return;
  end if;
  execute v_def;
end $$;

-- ── 7. self-tests — prove the three defects are actually closed ────────────────────────────────
do $$
declare
  v_def text;
  n_waived_firing int;
  v_monthly_pct numeric;
  v_annual_pct numeric;
  v_cols int;
begin
  -- (a) the detector is reachable from the roster
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_searchability_collapse' in v_def) = 0 then
    raise exception 'SELFTEST FAILED: detector is not in the roster — it would be orphaned';
  end if;

  -- (b) the metric counts monthly. gathern is 100% «شهري» by source: the old metric read 0.0%.
  select pct_annual_searchable, pct_period_searchable into v_annual_pct, v_monthly_pct
    from public.mon_searchability_now where platform = 'gathern';
  if v_monthly_pct is null then
    raise notice 'SELFTEST SKIPPED: no gathern rent-apartment rows to measure';
  elsif not (v_monthly_pct > 90 and v_annual_pct < 10) then
    raise exception 'SELFTEST FAILED: monthly rows still not counted as searchable (annual=%, period=%)',
      v_annual_pct, v_monthly_pct;
  end if;

  -- (c) a platform with a recorded no-period source never yields a period-driven verdict
  select count(*) into n_waived_firing
    from public.mon_searchability_alerts
   where period_waived and verdict in ('SEARCHABILITY_COLLAPSE','SEARCHABILITY_DROP');
  if n_waived_firing > 0 then
    raise exception 'SELFTEST FAILED: % waived platform(s) still raise a period-driven verdict',
      n_waived_firing;
  end if;

  -- (d) the snapshot actually persists the new numerator
  select count(*) into v_cols from information_schema.columns
   where table_name = 'mon_searchability_history' and column_name = 'searchable_by_period';
  if v_cols <> 1 then
    raise exception 'SELFTEST FAILED: history has no searchable_by_period column';
  end if;

  raise notice 'SELFTESTS PASSED: roster-wired, monthly counted, waivers respected, history extended';
end $$;