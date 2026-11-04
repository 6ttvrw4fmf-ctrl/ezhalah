-- MIRROR of the LIVE production object. NOT a migration — see the full-body-replace rule.
-- Refreshed 2026-11-04 (migration 20261104051446_stale_sweep_judges_its_keys_on_every_path): full-body replace.
--   md5 of everything below this header block (pg_get_functiondef in production, trailing newline): 31fae80c8e612554087185f99894648b
--   Change: stale_listings_detected and stale_coverage_gate are raised-or-resolved BEFORE the breaker and the
--   coverage gate can `continue` past them (stuck_open_alert 1293: keys sat unaffirmed up to 15 days while
--   their tables were behind the breaker). Carries 20261104032124 (greatest(last_seen_at,
--   last_verified_alive_at)) unchanged. Still deactivates nothing. Barrier: verify-monitors-judge-every-path.ts.
-- Refreshed 2026-11-04 (migration 20261104032124_stale_sweep_counts_direct_alive_verdicts): CHANGED. md5 of everything below: 4ce83b360801e87e0a556f0494621ea9
--   The stale count and the coverage gate's observed count now read greatest(last_seen_at, last_verified_alive_at):
--   a direct liveness oracle ALIVE verdict is source evidence (stronger than crawl presence), and the liveness
--   contract stamps only last_verified_alive_at for it. Needle-edit of three anchors, each asserted to match once;
--   confirmed against production the same hour: md5(pg_get_functiondef) = 4ce83b360801e87e0a556f0494621ea9.
-- Re-verified 2026-11-03 (migration 20261102212825_stale_breaker_escape_resolves_on_reset): UNCHANGED (history; superseded by the 2026-11-04 line above).
--   md5(pg_get_functiondef) in production = 46b864145225e1897ce0ad014c0732e2, identical to this file. Stamped for
--   verify-sql-mirrors-not-stale (B2): the 2026-11-02 stamp did not name this later same-day migration.
-- Refreshed 2026-11-02 (re-derived, see below) by the 🔧 Quality & Repair Engineer (2nd daily run) for migration
--   20261102212825_stale_breaker_escape_resolves_on_reset, which needle-edits this body: exactly one
--   match of the breaker-reset UPDATE asserted, a mon_resolve_key('stale_breaker_escape', …) line added
--   after it, nothing else changed. This body = the 2026-09-21 verified body + that exact replacement
--   (no other migration touched the function in between). Confirmed the same day against production:
--   md5(rtrim(pg_get_functiondef)) = 6674b49555ce85a03e200ab6526739cf, identical. md5 of everything below (with its trailing newline, the same convention as the 2026-09-21 line): 46b864145225e1897ce0ad014c0732e2
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
-- Re-verified 2026-09-21 by the Senior Data Integrity Engineer routine (routine-3), while
--   building mon_detect_liveness_rotation_stranded(). Production is UNCHANGED: md5 of
--   pg_get_functiondef is still 8a7e43fbf25479b558a69473a0fae7b6, 6,873 octets / 6,869
--   characters, identical to the 2026-08-29 capture below. No body edit — this line records a
--   re-verification, not a change.
--   WHY IT WAS RE-VERIFIED. This function's by-name exclusions are now load-bearing for a
--   second object: ops_stale_sweep_excluded_tables() (migration 20260921073600) PARSES this
--   definition at run time to learn which listing tables the stale sweep skips, so that
--   mon_detect_liveness_rotation_stranded() can watch exactly those and no others. The two
--   clauses it reads are `tablename not like 'wasalt_%'` and
--   `tablename <> 'aqar_residential_listings'`. Rewriting either of them changes which tables
--   are watched, silently and in the dangerous direction — a table dropped from BOTH
--   mechanisms at once. Measured that day: 169 aqar_residential rows sat active, unstruck and
--   unseen since 2026-07-25 precisely because nothing watched this exclusion (ops_incident
--   #374).
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
end $function$
