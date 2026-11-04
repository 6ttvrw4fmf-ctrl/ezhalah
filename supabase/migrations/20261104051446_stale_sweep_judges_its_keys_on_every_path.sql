-- Monitoring-meta, 2026-11-04: the daily stale sweep evaluates its two alert keys on EVERY path.
--
-- stuck_open_alert (alert 1293) held six alerts — stale_listings_detected for muhaysini and haraj,
-- stale_coverage_gate for haraj — whose last affirmation was 3 to 15 days old. Root cause, measured in
-- mon_stale_breaker_state: those four tables sat behind the circuit breaker (stale > 30 % of active)
-- until 2026-11-03, and mark_stale_listings_inactive() `continue`d past the breaker BEFORE it reached
-- either key. So for days the condition was neither re-affirmed (it was still true — worse, if
-- anything) nor resolved: a standing alert nobody stood behind, and a re-occurrence mon_raise() could
-- not page. The coverage gate had the same hole for stale_listings_detected, and never resolved its
-- own key when stale fell to 0 inside the gate.
--
-- The fix moves both judgements ahead of every early `continue`:
--   * stale_listings_detected — raised while stale > 0, resolved at stale = 0, for every table every run.
--     It is a REPORT (this function deactivates nothing), so the breaker and the coverage gate, which
--     exist to stop deactivation, have no reason to hide it.
--   * stale_coverage_gate — raised while the gate withholds stale rows, resolved when it does not,
--     now also measured on breaker days.
-- Deactivation behaviour is untouched: this function still deactivates nothing.

do $guard$
begin
  if md5(pg_get_functiondef('public.mark_stale_listings_inactive(integer,numeric)'::regprocedure))
     <> '4ce83b360801e87e0a556f0494621ea9' then
    raise exception 'mark_stale_listings_inactive changed since this patch was written; re-read and re-base it';
  end if;
end
$guard$;

create or replace function public.mark_stale_listings_inactive(stale_days integer default 7, max_frac numeric default 0.30)
returns integer
language plpgsql
as $function$
declare
  t text; n int; act int; stale int; total int := 0; skipped int := 0;
  escape_after_days constant int      := 3;
  escape_batch      constant int      := 25;
  alive_window      constant interval := interval '48 hours';
  coverage_frac     constant numeric  := 0.50;
  min_population    constant int      := 30;
  plat text; alive boolean; st record; escaped int;
  observed int; cov_window_hours int; coverage_floor int; cov_gated boolean;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
      and tablename not like 'wasalt_%'
      and tablename <> 'aqar_residential_listings'
  loop
    execute format('select count(*) from public.%I where active = true', t) into act;
    execute format('select count(*) from public.%I where active = true and greatest(last_seen_at, last_verified_alive_at) < now() - $1 * interval ''1 day''', t)
      using stale_days into stale;

    plat := regexp_replace(t, '_(residential|commercial)_listings$', '');

    -- 2026-11-04: the REPORT key is judged here, before any gate can `continue` past it. Breaker and
    -- coverage gate stop deactivation; this path deactivates nothing, so neither may hide the report.
    if stale > 0 then
      perform public.mon_raise(
        'P2', 'stale_listings_detected', plat, 'stale_listings_detected:' || t,
        jsonb_build_object(
          'table', t, 'active', act, 'stale', stale, 'stale_days', stale_days,
          'note', 'reported only — this path never deactivates (a time-based sweep cannot verify '
               || 'a listing is dead). Deactivation belongs to aqar/wasalt liveness, prune_unseen, '
               || 'or cleanup.py, all of which re-fetch the source first.'));
    else
      perform public.mon_resolve_key('stale_listings_detected', 'stale_listings_detected:' || t);
    end if;

    -- ROLLING COVERAGE, cadence-derived. Same window rule as mon_detect_refresh_coverage():
    -- a platform gets 3x its own expected scrape interval to cover its population. Platforms with
    -- no cadence row default to 24h -> a 72h window; aqar (8h) -> 24h; souq24 (48h) -> 144h.
    -- 2026-11-04: measured before the breaker too, so the gate's key is judged on breaker days.
    select coalesce(pc.expected_hours, 24) * 3 into cov_window_hours
      from public.platform_cadence pc where pc.platform = plat;
    cov_window_hours := coalesce(cov_window_hours, 72);

    -- Distinct ACTIVE rows re-confirmed at the source inside the window. Slice-agnostic by
    -- construction: 24 slices of 1/24th of the population each cover it exactly as well as one
    -- monolithic run, and no row is ever double-counted.
    execute format(
      'select count(*) from public.%I where active = true and greatest(last_seen_at, last_verified_alive_at) > now() - make_interval(hours => %s)',
      t, cov_window_hours) into observed;

    coverage_floor := ceil(coverage_frac * act);
    cov_gated := false;
    if act >= min_population and observed < coverage_floor then
      cov_gated := true;
    end if;

    if cov_gated and stale > 0 then
      perform public.mon_raise(
        'P2', 'stale_coverage_gate', plat, 'stale_coverage_gate:' || t,
        jsonb_build_object(
          'table', t, 'active', act, 'stale_withheld', stale,
          'observed_in_window', observed,
          'coverage_floor', coverage_floor,
          'coverage_frac', coverage_frac,
          'window_hours', cov_window_hours,
          'measure', 'distinct ACTIVE rows whose greatest(last_seen_at, last_verified_alive_at) is inside the window '
                  || '(a direct liveness oracle ALIVE verdict counts: it is stronger evidence than crawl presence). '
                  || 'Every write to last_seen_at is a real source observation (a crawl upsert, '
                  || 'or a liveness oracle confirming the listing live); no DB function writes '
                  || 'it, so a blocked crawl cannot inflate this number. Replaced '
                  || 'max(rows_seen) of a single run on 2026-08-29: that could never be met by a '
                  || 'sliced scraper, was satisfiable by a non-capture bookkeeping run, and was '
                  || 'vacuous for commercial tables.'));
    else
      perform public.mon_resolve_key('stale_coverage_gate', 'stale_coverage_gate:' || t);
    end if;

    if act >= min_population and stale > max_frac * act then
      raise notice 'mark_stale: SKIP %  (% of % active would go stale > %%%)', t, stale, act, (max_frac*100)::int;
      skipped := skipped + 1;

      insert into public.mon_stale_breaker_state as s
             (tbl, consecutive_breaker_days, last_breaker_at, updated_at)
      values (t, 1, now(), now())
      on conflict (tbl) do update
        set consecutive_breaker_days = case
              when s.last_breaker_at >= date_trunc('day', now()) then s.consecutive_breaker_days
              else s.consecutive_breaker_days + 1 end,
            last_breaker_at = now(),
            updated_at      = now();

      select * into st from public.mon_stale_breaker_state where tbl = t;

      alive := exists (
        select 1 from public.scrape_runs r
        where r.ok
          and r.started_at > now() - alive_window
          and (r.platform = plat or r.platform ~ ('^' || plat || '[_:]'))
      );

      if st.consecutive_breaker_days >= escape_after_days
         and alive
         and (st.last_escape_at is null or st.last_escape_at < date_trunc('day', now()))
      then
        escaped := 0;

        update public.mon_stale_breaker_state
           set last_escape_at = now(),
               updated_at     = now()
         where tbl = t;

        perform public.mon_raise(
          'P2', 'stale_breaker_escape', plat, 'stale_breaker_escape:' || t,
          jsonb_build_object(
            'table', t, 'active', act, 'stale', stale,
            'consecutive_breaker_days', st.consecutive_breaker_days,
            'note', 'breaker escape reached; NOT deactivating (time-based kills are unverified). '
                 || 'Needs a source-verified liveness/re-probe pass for this platform.'));

        raise notice 'mark_stale: ESCAPE % — % stale row(s) REPORTED, none deactivated (breaker day %)',
          t, stale, st.consecutive_breaker_days;
      end if;

      continue;
    end if;

    update public.mon_stale_breaker_state
       set consecutive_breaker_days = 0, updated_at = now()
     where tbl = t and consecutive_breaker_days <> 0;
    -- 2026-11-02: the breaker did not trip for this table on this run, so its escape alert is no longer true.
    perform public.mon_resolve_key('stale_breaker_escape', 'stale_breaker_escape:' || t);

    if cov_gated then
      skipped := skipped + 1;
      raise notice 'mark_stale: COVERAGE-SKIP % (observed=% of % active in %h < floor=% ; % stale row(s) withheld)',
        t, observed, act, cov_window_hours, coverage_floor, stale;
      continue;
    end if;

    n := 0;
    if stale > 0 then
      raise notice 'mark_stale: % stale row(s) in % REPORTED, none deactivated', stale, t;
    end if;
    total := total + n;
  end loop;
  if skipped > 0 then raise notice 'mark_stale: % table(s) skipped by circuit breaker / coverage gate', skipped; end if;
  return total;
end $function$;
