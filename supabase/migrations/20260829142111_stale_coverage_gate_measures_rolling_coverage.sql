-- Stale coverage gate: measure rolling coverage, not one run's row count.
--
-- THE DEFECT (senior audit run #69, 2026-08-29; owner-directed follow-up)
-- The gate asked "did ONE recent run see >= 50% of this table's active population?" via
-- max(scrape_runs.rows_seen). For a platform that deliberately crawls itself in slices that
-- question has no true answer: gathern is scraped in ~24 slices/day and its all-time best SINGLE
-- run across 830 successful runs since 2026-06-23 is 5,823 rows against a floor of ~14,700. The
-- gate could therefore never go green on merit -- and a barrier that cannot go green is
-- decoration.
--
-- Worse, it was not merely impossible, it was ARBITRARY. The run-matching pattern
-- ('^' || plat || '[_:]') also matches non-capture bookkeeping rows, so gathern's gate was in
-- practice decided by whether a `gathern_prune` row (rows_seen=18,226) happened to fall inside the
-- 48h window -- passing for a reason that has nothing to do with crawl coverage, and flapping
-- when that row aged out. That is the whole history of stale_coverage_gate:gathern.
--
-- And it was VACUOUS for every commercial table: recent_best is a PER-PLATFORM run count compared
-- against a PER-TABLE population, so hajer_commercial (1 active row) was measured against hajer's
-- 122-row residential run -- 12,200% "coverage". Coverage was never actually checked there.
--
-- THE FIX: measure what the proxy was proxying for -- distinct ACTIVE rows confirmed at the source
-- inside a rolling, cadence-derived window. This is not a new invention: it is exactly the measure
-- mon_detect_refresh_coverage() has been computing daily (window = expected_hours * 3, floor 50%),
-- so the two gates that share an intent now share a definition instead of contradicting each other.
--
-- WHY last_seen_at IS A TRUSTWORTHY SOURCE SIGNAL (verified 2026-08-29): NO database function
-- writes it -- checked across every function body in the public schema. Every write comes from
-- scrapers/common/db.py, and both writers are real source observations: _wasalt_batch (the single
-- funnel every platform's upsert goes through) sets it for rows "seen on the source THIS crawl",
-- and the prune self-heal path sets it only for listings a liveness oracle re-fetched and
-- confirmed live. A blocked crawl writes nothing, so the measure fails CLOSED.
--
-- MEASURED BEFORE/AFTER over all 28 tables with >= 30 active rows (2026-08-29):
--   * aqarmonthly_residential  1,249/1,739 = 72%  old TRIPPED, new passes -- false positive
--     removed (32 sync runs/day, so no single run approaches the floor).
--   * dealapp_commercial         258/650   = 40%  old PASSED, new trips -- NEW CATCH of a real
--     degradation (182 rows already stale >= 7d) that the old gate missed because it compared
--     dealapp's residential run count against the commercial population.
--   * dealapp_residential      6,365/15,252 = 42% both trip. erapulse_residential 0/50 = 0% both
--     trip. Genuine coverage loss still fails closed.
--   * gathern_residential     22,007/29,339 = 75% both pass -- and gathern is NOT permanently
--     green on the new measure: mon_refresh_coverage_alerts recorded it at 46.2% on 2026-08-10,
--     which the new gate would have caught and the old one reported for the wrong reason.
--   * The other 24 tables sit at 90-100% and are unchanged.
--
-- Unchanged by design: this function still NEVER deactivates anything (n := 0 throughout; a
-- time-based sweep cannot verify a listing is dead). The circuit breaker, the breaker-escape
-- branch and its separate 48h `alive` check, and every alert lifecycle are untouched.
CREATE OR REPLACE FUNCTION public.mark_stale_listings_inactive(stale_days integer DEFAULT 7, max_frac numeric DEFAULT 0.30)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  t text; n int; act int; stale int; total int := 0; skipped int := 0;
  escape_after_days constant int      := 3;
  escape_batch      constant int      := 25;
  alive_window      constant interval := interval '48 hours';
  coverage_frac     constant numeric  := 0.50;
  min_population    constant int      := 30;
  plat text; alive boolean; st record; escaped int;
  observed int; cov_window_hours int; coverage_floor int;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
      and tablename not like 'wasalt_%'
      and tablename <> 'aqar_residential_listings'
  loop
    execute format('select count(*) from public.%I where active = true', t) into act;
    execute format('select count(*) from public.%I where active = true and last_seen_at < now() - $1 * interval ''1 day''', t)
      using stale_days into stale;

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

      plat  := regexp_replace(t, '_(residential|commercial)_listings$', '');
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

    plat := regexp_replace(t, '_(residential|commercial)_listings$', '');

    -- ROLLING COVERAGE, cadence-derived. Same window rule as mon_detect_refresh_coverage():
    -- a platform gets 3x its own expected scrape interval to cover its population. Platforms with
    -- no cadence row default to 24h -> a 72h window; aqar (8h) -> 24h; souq24 (48h) -> 144h.
    select coalesce(pc.expected_hours, 24) * 3 into cov_window_hours
      from public.platform_cadence pc where pc.platform = plat;
    cov_window_hours := coalesce(cov_window_hours, 72);

    -- Distinct ACTIVE rows re-confirmed at the source inside the window. Slice-agnostic by
    -- construction: 24 slices of 1/24th of the population each cover it exactly as well as one
    -- monolithic run, and no row is ever double-counted.
    execute format(
      'select count(*) from public.%I where active = true and last_seen_at > now() - make_interval(hours => %s)',
      t, cov_window_hours) into observed;

    coverage_floor := ceil(coverage_frac * act);

    if act >= min_population and observed < coverage_floor then
      skipped := skipped + 1;
      raise notice 'mark_stale: COVERAGE-SKIP % (observed=% of % active in %h < floor=% ; % stale row(s) withheld)',
        t, observed, act, cov_window_hours, coverage_floor, stale;
      if stale > 0 then
        perform public.mon_raise(
          'P2', 'stale_coverage_gate', plat, 'stale_coverage_gate:' || t,
          jsonb_build_object(
            'table', t, 'active', act, 'stale_withheld', stale,
            'observed_in_window', observed,
            'coverage_floor', coverage_floor,
            'coverage_frac', coverage_frac,
            'window_hours', cov_window_hours,
            'measure', 'distinct ACTIVE rows whose last_seen_at was refreshed inside the window. '
                    || 'Every write to last_seen_at is a real source observation (a crawl upsert, '
                    || 'or a liveness oracle confirming the listing live); no DB function writes '
                    || 'it, so a blocked crawl cannot inflate this number. Replaced '
                    || 'max(rows_seen) of a single run on 2026-08-29: that could never be met by a '
                    || 'sliced scraper, was satisfiable by a non-capture bookkeeping run, and was '
                    || 'vacuous for commercial tables.'));
      end if;
      continue;
    end if;

    update public.alert_event set resolved_at = now()
     where kind = 'stale_coverage_gate' and dedup_key = 'stale_coverage_gate:' || t and resolved_at is null;

    n := 0;
    if stale > 0 then
      perform public.mon_raise(
        'P2', 'stale_listings_detected', plat, 'stale_listings_detected:' || t,
        jsonb_build_object(
          'table', t, 'active', act, 'stale', stale, 'stale_days', stale_days,
          'note', 'reported only — this path never deactivates (a time-based sweep cannot verify '
               || 'a listing is dead). Deactivation belongs to aqar/wasalt liveness, prune_unseen, '
               || 'or cleanup.py, all of which re-fetch the source first.'));
      raise notice 'mark_stale: % stale row(s) in % REPORTED, none deactivated', stale, t;
    else
      update public.alert_event set resolved_at = now()
       where kind = 'stale_listings_detected' and dedup_key = 'stale_listings_detected:' || t
         and resolved_at is null;
    end if;
    total := total + n;
  end loop;
  if skipped > 0 then raise notice 'mark_stale: % table(s) skipped by circuit breaker / coverage gate', skipped; end if;
  return total;
end $function$;
