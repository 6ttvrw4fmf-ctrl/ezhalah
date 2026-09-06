-- A DETECTOR'S FINDING MUST BE ABLE TO REACH A HUMAN (ops_incident #71).
--
-- Two detectors emitted findings that no one could ever see. Both are deliberately OFF the
-- mon_run_all_detectors roster and own their own daily cron jobs (58 mon-refresh-coverage 06:25,
-- 59 mon-price-magnitude-gate 06:35), which is legitimate — mon_detect_orphaned_detectors exempts
-- cron-owning detectors and was correct to report zero. The defect is downstream of that:
--
--   * mon_detect_refresh_coverage INSERTs into mon_refresh_coverage_alerts and never raises.
--     Measured 2026-09-06: 23 rows in that table, most recent 2026-09-05 06:25, and ZERO functions
--     anywhere in the database read it. Twenty-three real platform-coverage findings, none of which
--     ever became an alert.
--   * mon_detect_price_magnitude_gate has no INSERT and no mon_raise. It signals only by
--     `return next`, and its cron command is `select public.mon_detect_price_magnitude_gate();` —
--     a bare select DISCARDS a RETURNS TABLE result. It happens to be clean today, so nothing is
--     being lost right now, but any future signal is unobservable by construction. That detector
--     guards the owner-locked rule that a source-published price is searchable at ANY magnitude
--     (2026-08-03), which is precisely the class this session has been working in.
--
-- Both keep their existing shape — the table write and the returned rows are untouched, because
-- other things may read them by hand — and each now ALSO raises. mon_resolve clears the class when
-- a run comes back clean, so a fixed problem does not stay lit.
--
-- Dedup keys are per-platform for coverage (so one bad platform does not mask another) and
-- per-signal for the gate.

create or replace function public.mon_detect_refresh_coverage()
 returns table(platform text, active_rows bigint, refreshed bigint, coverage_pct numeric, window_hours integer, severity text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare rec record; t text; win int; a bigint; r bigint; tot_a bigint; tot_r bigint; pct numeric; sev text;
        seen text[] := '{}';
begin
  for rec in
    select regexp_replace(tablename,'_(residential|commercial)_listings$','') as p,
           array_agg(tablename) as tabs
    from pg_tables
    where schemaname='public' and tablename ~ '_(residential|commercial)_listings$'
    group by 1
  loop
    if exists (select 1 from platform_cadence pc
               where pc.platform = rec.p and pc.is_active = false) then
      continue;
    end if;
    select coalesce((select pc.expected_hours from platform_cadence pc where pc.platform = rec.p), 24) * 3
      into win;
    tot_a := 0; tot_r := 0;
    foreach t in array rec.tabs loop
      execute format(
        'select count(*), count(*) filter (where last_seen_at > now() - make_interval(hours => %s))
           from public.%I where active', win, t) into a, r;
      tot_a := tot_a + coalesce(a,0); tot_r := tot_r + coalesce(r,0);
    end loop;
    if tot_a < 50 then
      continue;
    end if;
    pct := round(100.0 * tot_r / tot_a, 1);
    if pct < 50 then
      sev := case when pct < 20 then 'critical' else 'warning' end;
      insert into public.mon_refresh_coverage_alerts
        (platform, active_rows, refreshed, coverage_pct, window_hours, severity)
      values (rec.p, tot_a, tot_r, pct, win, sev);
      -- …and make it reachable. The table write above is kept: it is the historical record.
      perform public.mon_raise(
        case when sev = 'critical' then 'P1' else 'P2' end,
        'refresh_coverage', rec.p,
        'refresh_coverage:' || rec.p,
        jsonb_build_object('platform', rec.p, 'active_rows', tot_a, 'refreshed', tot_r,
                           'coverage_pct', pct, 'window_hours', win, 'severity', sev,
                           'why', format('only %s%% of %s active rows were re-seen inside the %sh window', pct, tot_a, win)));
      seen := seen || rec.p;
      platform := rec.p; active_rows := tot_a; refreshed := tot_r;
      coverage_pct := pct; window_hours := win; severity := sev;
      return next;
    end if;
  end loop;

  -- clear platforms that have recovered, so a fixed problem does not stay lit
  perform public.mon_resolve('refresh_coverage', a.scope)
    from (select distinct scope from public.alert_event
           where kind = 'refresh_coverage' and resolved_at is null) a
   where not (a.scope = any(seen));
end $function$;

create or replace function public.mon_detect_price_magnitude_gate()
 returns table(signal text, detail text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare body text; searchable bigint; raw_ct bigint; fired text[] := '{}';
begin
  body := pg_get_functiondef('public.enforce_price_size_sanity'::regproc);
  if body ~ 'price_total\s*<\s*[0-9]' or body ~ 'price_annual\s*<\s*[0-9]' then
    signal := 'trigger_gate_returned';
    detail := 'enforce_price_size_sanity() compares a price against a magnitude again. '
           || 'A source-published price is stored and searchable at ANY magnitude '
           || '(owner rule 2026-08-03; 204/204 live sub-1000 Buy rows matched their source page '
           || 'on 2026-08-09). Restore the removal or get an explicit owner decision.';
    perform public.mon_raise('P1', 'price_magnitude_gate', 'trigger',
      'price_magnitude_gate:trigger_gate_returned',
      jsonb_build_object('signal', signal, 'detail', detail));
    fired := fired || 'trigger';
    return next;
  end if;

  select count(*) into searchable
  from public.search_listings_ar
  where deal_ar = 'بيع' and price_total between 1 and 999;

  select count(*) into raw_ct from public.ops_sub1000_raw_restore_20260809;

  if raw_ct > 0 and searchable < raw_ct / 2 then
    signal := 'sub1000_prices_vanished';
    detail := format('only %s of %s known source-published sub-1000 Buy prices are searchable; '
                  || 'evidence: scripts/ops/evidence/, restore: '
                  || 'scripts/ops/repair_sub1000_price_restore_2026-08-09.sql', searchable, raw_ct);
    perform public.mon_raise('P1', 'price_magnitude_gate', 'sub1000',
      'price_magnitude_gate:sub1000_prices_vanished',
      jsonb_build_object('signal', signal, 'detail', detail,
                         'searchable', searchable, 'known_published', raw_ct));
    fired := fired || 'sub1000';
    return next;
  end if;

  if not ('trigger' = any(fired)) then perform public.mon_resolve('price_magnitude_gate', 'trigger'); end if;
  if not ('sub1000' = any(fired)) then perform public.mon_resolve('price_magnitude_gate', 'sub1000'); end if;
end $function$;
