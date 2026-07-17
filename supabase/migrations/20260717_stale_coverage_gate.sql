-- ─────────────────────────────────────────────────────────────────────────────────────────
-- STALE COVERAGE GATE — fix the confirmed false-positive inactivation in
-- mark_stale_listings_inactive().  STAGED 2026-07-17 on branch fix/stale-coverage-gate.
-- NOT applied to prod from this branch (main session merges + deploys under lock).
-- Rehearsed end-to-end in BEGIN..ROLLBACK against live prod 2026-07-17 (results in the
-- companion notes / task report; prod re-verified byte-identical after each ROLLBACK).
--
-- Builds VERBATIM on the live prod definition of mark_stale_listings_inactive
-- (the "bounded escape" B5 version from 20260717_lifecycle_safety.sql — confirmed live via
-- pg_get_functiondef 2026-07-17): the 30%-collapse circuit breaker, the mon_stale_breaker_state
-- bookkeeping, the bounded-escape branch, and the wasalt_% / aqar_residential_listings
-- exclusions are all preserved unchanged.  Only two things change, both described below.
--
-- ══ ROOT CAUSE (confirmed by main session) ══════════════════════════════════════════════
-- mark_stale flipped active=false purely on last_seen_at age (> stale_days) with NO proof the
-- listing was actually delisted, and hard-stamped missing_count = 3 — which PERMANENTLY locks
-- the row out of the nightly recovery net auto_recover_false_inactive() (that job only touches
-- coalesce(missing_count,0)=0 rows).  On platforms whose crawler UNDER-ENUMERATES its own
-- catalog, a live-but-not-recently-crawled listing dies on day-8 and can never come back.
--
-- dealapp is the main victim: its crawler's rows_seen swings 93–1632 against ~2,537 active
-- residential rows, and the daily 04:00 kill count moves INVERSELY with coverage (a 268-seen
-- day killed 906; a 1632-seen day killed 14).  ~1,850 dealapp rows sit inactive; 943 of them
-- carry the pure time-sweep signature (deactivated_at ≈ 04:00 UTC on a mark_stale day AND
-- last_seen_at 7–8 days earlier).  The one-time data heal for those 943 rows ships as a
-- companion file: 20260717_stale_coverage_gate_dealapp_heal.sql.
--
-- ══ CHANGE 1 — COVERAGE GATE (the core fix) ═════════════════════════════════════════════
-- Before the NORMAL age-sweep of a table, require EVIDENCE the crawler actually achieved
-- adequate coverage recently.  Concretely: skip the age-sweep for a table (act >= 8) unless
-- the platform's best ok=true scrape_runs.rows_seen in the last 48h is >= 50% of that table's
-- current active count.  If the crawler under-performed, the "staleness" is a crawl artifact,
-- not a delisting → do NOT sweep; raise a debounced P2 alert (mon_raise, dedup per table) so
-- the withheld sweep is visible, and clear it (mon_resolve) once coverage recovers.
--
-- FLOOR CHOICE — 0.50 × the table's active count (the more-robust of the two candidates the
-- brief offered).  The alternative, the trailing-7-day median rows_seen, LAUNDERS chronic
-- under-coverage into an "acceptable" floor: dealapp's 7d median is only ~378 (dragged down by
-- weeks of weak runs), so a median floor would keep blessing the very runs that cause the false
-- kills.  A catalog-anchored 50% floor demands real coverage: dealapp's good days (1605/1632)
-- clear it and sweep normally; its weak days (93–787) are gated.  When a platform is CHRONICALLY
-- under-covered (e.g. gathern at ~27% of active, aqarmonthly at ~16%), the gate simply defers
-- aging to that scraper's own conservative prune_unseen() 3-strike path — the SAFE failure mode
-- (never kill on weak evidence), and the alert surfaces the crawler gap for a human.
-- Note (accepted limitation): rows_seen is platform-level while the floor is per-table, so for a
-- multi-table platform the gate is lenient toward the SMALLER sub-vertical and strict on the
-- larger one (where the false-kill blast radius lives) — never stricter than today's ungated
-- behavior, so it can only reduce false kills, never add them.
--
-- Blast radius on live prod 2026-07-17 (read-only simulation): 60 swept tables have 0 stale
-- rows (no effect), 1 table is on the breaker path (dealapp_commercial, 96), and exactly 3
-- tables are newly coverage-gated — gathern_residential (478 rows/day now protected),
-- aqarmonthly_residential (7), jazwtn_residential (0 stale, scraper cold).  NO healthy,
-- well-covered table with pending stale rows is frozen by the gate.
--
-- ══ CHANGE 2 — DON'T PERMANENTLY LOCK (age-sweep + escape) ═══════════════════════════════
-- The age-sweep and the bounded-escape branch now stamp missing_count = 0 instead of 3, so a
-- genuinely-live listing that later gets re-crawled can auto-reactivate: the scraper's batch
-- upsert writes active=true + missing_count=0 + fresh last_seen_at on re-see, and/or the 05:20
-- auto_recover_false_inactive() heals it.  This does NOT let auto_recover thrash a truly-gone
-- row: auto_recover ALSO requires last_seen_at within 24h AND a sane price (verified against its
-- live def), and a just-swept row's last_seen_at is > 7 days old — so it stays inactive until it
-- is genuinely re-seen.  Gone rows are never re-seen → they stay gone.
--
-- SCOPE of Change 2: ONLY the two age-based UPDATEs inside mark_stale.  The scrapers'
-- source-confirmed sold-pin path (_pin_sold_inactive → active=false + missing_count=3 on a
-- مباع/مؤجر badge, written post-upsert with a FRESH last_seen_at) is DELIBERATELY untouched;
-- those pins are correct and must never be reactivated.
--
-- UNTOUCHED by this migration: gathern / wasalt / aqar data rows (no row is modified here — this
-- file only redefines a function); the wasalt_% and aqar_residential_listings sweep exclusions
-- (preserved verbatim); the sold-pin mc=3 path in the scrapers; every other lifecycle function.
--
-- ROLLBACK PLAN
--   Restore the previous mark_stale_listings_inactive body from
--   supabase/migrations/20260717_lifecycle_safety.sql (git history).  No table/DDL is added
--   or dropped by this file, so there is nothing else to undo.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.mark_stale_listings_inactive(stale_days integer default 7, max_frac numeric default 0.30)
 returns integer
 language plpgsql
as $fn$
declare
  t text; n int; act int; stale int; total int := 0; skipped int := 0;
  -- bounded-escape knobs (see 20260717_lifecycle_safety.sql header)
  escape_after_days constant int      := 3;
  escape_batch      constant int      := 25;
  alive_window      constant interval := interval '48 hours';
  -- coverage-gate knob (see header, CHANGE 1): require the platform's best ok run in the last
  -- alive_window to have seen >= coverage_frac of the table's active count before age-sweeping.
  coverage_frac     constant numeric  := 0.50;
  plat text; alive boolean; st record; escaped int;
  recent_best int; coverage_floor int;
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

    if act >= 8 and stale > max_frac * act then
      raise notice 'mark_stale: SKIP %  (% of % active would go stale > %%%)', t, stale, act, (max_frac*100)::int;
      skipped := skipped + 1;

      -- breaker-day bookkeeping: count at most once per calendar day
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

      -- scraper-alive gate: the escape must NEVER run when the scraper itself is dead
      -- (that is the wipe-protection case the breaker exists for)
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
        -- CHANGE 2: missing_count = 0 (was 3) so a re-seen-alive escaped row can auto-recover;
        -- a truly-gone row keeps its > 7-day-old last_seen_at and auto_recover never touches it.
        execute format(
          'update public.%1$I set active = false, missing_count = 0
            where id in (select id from public.%1$I
                          where active = true and last_seen_at < now() - $1 * interval ''1 day''
                          order by last_seen_at asc limit %2$s)',
          t, escape_batch)
        using stale_days;
        get diagnostics escaped = row_count;
        total := total + escaped;

        update public.mon_stale_breaker_state
           set last_escape_at = now(),
               total_escaped  = total_escaped + escaped,
               updated_at     = now()
         where tbl = t;

        raise notice 'mark_stale: ESCAPE % — flipped % oldest-stale row(s) mc=0 (breaker day %, scraper alive)',
          t, escaped, st.consecutive_breaker_days;
      end if;

      continue;
    end if;

    -- breaker not tripped today: a healthy run resets the consecutive counter
    update public.mon_stale_breaker_state
       set consecutive_breaker_days = 0, updated_at = now()
     where tbl = t and consecutive_breaker_days <> 0;

    -- CHANGE 1: COVERAGE GATE. Do not age-sweep a table on weak crawler coverage — the
    -- "staleness" is then a crawl artifact, not a delisting. Skip (+ debounced alert) unless the
    -- platform's best ok=true run in the last 48h saw >= coverage_frac of this table's active set.
    plat := regexp_replace(t, '_(residential|commercial)_listings$', '');
    select max(r.rows_seen) into recent_best
      from public.scrape_runs r
     where r.ok
       and r.started_at > now() - alive_window
       and (r.platform = plat or r.platform ~ ('^' || plat || '[_:]'));
    coverage_floor := ceil(coverage_frac * act);

    if act >= 8 and (recent_best is null or recent_best < coverage_floor) then
      skipped := skipped + 1;
      raise notice 'mark_stale: COVERAGE-SKIP % (recent_best=% < floor=% ; % stale row(s) withheld)',
        t, coalesce(recent_best, 0), coverage_floor, stale;
      -- alert only when a sweep was actually withheld (rows at risk); silence for 0-stale tables
      if stale > 0 then
        perform public.mon_raise(
          'P2', 'stale_coverage_gate', plat, 'stale_coverage_gate:' || t,
          jsonb_build_object(
            'table', t, 'active', act, 'stale_withheld', stale,
            'recent_best_rows_seen', recent_best, 'coverage_floor', coverage_floor,
            'coverage_frac', coverage_frac, 'window_hours', 48));
      end if;
      continue;
    end if;

    -- coverage adequate → clear THIS table's open gate alert (per-table dedup, so a passing
    -- sub-vertical never resolves a still-gated sibling of the same platform), then sweep
    update public.alert_event set resolved_at = now()
     where kind = 'stale_coverage_gate' and dedup_key = 'stale_coverage_gate:' || t and resolved_at is null;

    -- CHANGE 2: missing_count = 0 (was 3) — a genuinely-live row that gets re-crawled
    -- auto-reactivates; a genuinely-gone row is never re-seen and stays inactive.
    execute format(
      'update public.%I set active = false, missing_count = 0 where active = true and last_seen_at < now() - $1 * interval ''1 day''',
      t
    ) using stale_days;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  if skipped > 0 then raise notice 'mark_stale: % table(s) skipped by circuit breaker / coverage gate', skipped; end if;
  return total;
end $fn$;

-- Same exposure class as the prior definition: cron (owner) is the only legitimate caller.
revoke execute on function public.mark_stale_listings_inactive(integer, numeric) from public, anon, authenticated;

-- PostgREST: the function was redefined
notify pgrst, 'reload schema';
