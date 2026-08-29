-- MIRROR of the LIVE production object. NOT a migration — see the full-body-replace rule.
-- Refreshed 2026-08-29 (first capture) by the Senior Production Engineer routine, in the same
--   change that fixed the coverage gate (migration 20260829142111, owner-directed).
--   mark_stale_listings_inactive() is the daily stale sweep (pg_cron jobid 13, 04:00 UTC). Two
--   things about it are load-bearing and were invisible in the repo because it had NO mirror:
--     1. It NEVER deactivates anything. `n := 0` throughout; every branch only REPORTS. A reader
--        who assumes the name is accurate will over-estimate the blast radius of any change here.
--     2. Its coverage gate decides whether a table's stale count is trustworthy enough to report.
--        Until 2026-08-29 that gate asked "did ONE run see >= 50% of the population" via
--        max(scrape_runs.rows_seen) — unanswerable for a sliced scraper (gathern crawls itself in
--        ~24 slices/day; best single run 5,823 vs a floor of ~14,700), decided in practice by
--        whether a non-capture `gathern_prune` row fell in the window, and vacuous for commercial
--        tables (a per-PLATFORM run count compared against a per-TABLE population).
--   It now measures distinct ACTIVE rows re-confirmed at the source inside a cadence-derived
--   window (expected_hours * 3), the same measure mon_detect_refresh_coverage() already used.
--   Re-derived verbatim from pg_get_functiondef (base64 round-trip), never hand-transcribed.
-- Verified byte-exact; md5 of everything below this header block: 8a7e43fbf25479b558a69473a0fae7b6
--   equals md5(pg_get_functiondef) in production, 6,873 octets / 6,869 characters both sides
--   (the body carries 4 multi-byte em-dashes), checked 2026-08-29.
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
end $function$
