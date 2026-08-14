-- RECOVERED VERBATIM from production (AGENTS.md "Migration drift guard", P0).
--
-- Applied to production 2026-08-14 19:11 UTC as `stale_breaker_min_population_floor` by another
-- session and never committed. A function live in production with no git record is the exact
-- precondition of the 2026-07-16 PGRST203 search outage — nobody can review, diff or roll back what
-- they cannot see. Recovered byte-for-byte from
-- supabase_migrations.schema_migrations.statements (version 20260814191140).
--
-- Diffed all 436 committed migration versions against production: this was the ONLY gap.
--
-- What it changes: adds `min_population := 30` so the stale circuit-breaker and the coverage gate
-- only engage on tables with a meaningful active population — a 4-row table crossing a 30% stale
-- fraction is noise, not a signal. Both paths remain REPORT-ONLY: neither ever deactivates a
-- listing, because a time-based sweep cannot verify a listing is dead.
--
-- NOT self-merged: touches supabase/migrations/, so per the daily/senior routine rules this PR
-- stays OPEN for review.
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
