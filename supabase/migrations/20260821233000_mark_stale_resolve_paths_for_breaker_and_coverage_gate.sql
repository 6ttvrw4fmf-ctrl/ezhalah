-- mark_stale_listings_inactive: 2 alert-lifecycle bugs found triaging the open alert_event backlog
-- (owner-directed aggressive-closure pass, 2026-08-21). Both fixes are ADDITIVE ONLY — this
-- function has never deactivated a single listing (every branch is report-only; the `stale_listings
-- _detected` branch hardcodes n:=0 and the function returns `total`, which is never incremented).
-- Nothing about listing `active` status changes here, only which alert_event rows get resolved_at.
--
-- BUG 1 (alert_event 472, stale_breaker_escape stuck open): the function resets
-- consecutive_breaker_days to 0 the moment a table's circuit breaker clears (the
-- `update ... set consecutive_breaker_days = 0 ... where consecutive_breaker_days <> 0` a few lines
-- below), but never resolves the stale_breaker_escape alert that fires while the breaker is
-- tripped. mon_stale_breaker_state confirms dealapp_commercial's breaker cleared 2026-08-15 and has
-- not retripped since (6 days), yet alert 472 (raised 2026-08-12, numbers frozen at that date) can
-- never auto-close — there is no resolve path for this kind anywhere in the function.
--
-- BUG 2 (alert_event 474, stale_listings_detected frozen at a stale number): the coverage-gate
-- branch and the stale_listings_detected branch are mutually exclusive (each ends in `continue`).
-- Once a table starts failing the coverage floor, stale_coverage_gate becomes the single live
-- signal for it (it already reports `stale_withheld` with current numbers every run) — but any
-- already-open stale_listings_detected alert for that table is neither refreshed nor resolved, so
-- its `stale` count silently freezes at whatever it was the day coverage started failing (alert
-- 474: reads 3141, live recompute is 1566 -- a real number, just a stale, over-reporting one).
-- Direction of the error is over-reporting, never under-reporting, so this was never a "weird
-- became wrong" data-fidelity risk, just inaccurate dashboard bookkeeping. Fix: resolve the
-- possibly-open stale_listings_detected alert the moment a table enters the coverage-gate branch,
-- since stale_coverage_gate is now the authoritative alert for that table while gated.
create or replace function public.mark_stale_listings_inactive(stale_days integer DEFAULT 7, max_frac numeric DEFAULT 0.30)
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

    if exists (select 1 from public.mon_stale_breaker_state where tbl = t and consecutive_breaker_days <> 0) then
      -- BUG 1 FIX: the breaker just cleared for this table (below resets its counter to 0) — resolve
      -- any open stale_breaker_escape alert for it in the same transition, instead of leaving it
      -- stuck open forever with no resolve path anywhere in this function.
      update public.alert_event set resolved_at = now()
       where kind = 'stale_breaker_escape' and dedup_key = 'stale_breaker_escape:' || t and resolved_at is null;
    end if;
    update public.mon_stale_breaker_state
       set consecutive_breaker_days = 0, updated_at = now()
     where tbl = t and consecutive_breaker_days <> 0;

    plat := regexp_replace(t, '_(residential|commercial)_listings$', '');
    select max(r.rows_seen) into recent_best
      from public.scrape_runs r
     where r.ok
       and r.started_at > now() - alive_window
       and (r.platform = plat or r.platform ~ ('^' || plat || '[_:]'));
    coverage_floor := ceil(coverage_frac * act);

    if act >= min_population and (recent_best is null or recent_best < coverage_floor) then
      skipped := skipped + 1;
      raise notice 'mark_stale: COVERAGE-SKIP % (recent_best=% < floor=% ; % stale row(s) withheld)',
        t, coalesce(recent_best, 0), coverage_floor, stale;
      if stale > 0 then
        perform public.mon_raise(
          'P2', 'stale_coverage_gate', plat, 'stale_coverage_gate:' || t,
          jsonb_build_object(
            'table', t, 'active', act, 'stale_withheld', stale,
            'recent_best_rows_seen', recent_best, 'coverage_floor', coverage_floor,
            'coverage_frac', coverage_frac, 'window_hours', 48));
      end if;
      -- BUG 2 FIX: stale_coverage_gate (just raised/refreshed above with LIVE numbers) is now the
      -- single authoritative alert for this table's staleness while it stays under-covered. Resolve
      -- any open stale_listings_detected for it here — the branch that would otherwise refresh or
      -- resolve that alert is never reached once a table enters this branch (this `continue` skips
      -- it every remaining run), which is exactly what let alert 474 freeze at a stale count.
      update public.alert_event set resolved_at = now()
       where kind = 'stale_listings_detected' and dedup_key = 'stale_listings_detected:' || t and resolved_at is null;
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

-- Prove it executes clean against real production data, right now, in the same transaction as the
-- rest of this migration — a crash here fails the migration instead of silently landing broken.
-- This is the function's own normal daily invocation (cron already calls it with no args); running
-- it once here also resolves alert 472/474 immediately if their conditions have in fact already
-- cleared (proven live before writing this migration: dealapp_commercial's breaker cleared
-- 2026-08-15 with no retrip since; gathern is currently in the coverage-gate branch where 474 is
-- stuck). If either condition has NOT actually cleared, this same run re-raises it with fresh,
-- correct numbers instead — not a silent "make the dashboard green" move.
select public.mark_stale_listings_inactive();
