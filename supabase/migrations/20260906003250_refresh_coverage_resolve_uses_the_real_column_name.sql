-- Fix-forward on the previous migration: the recovery sweep referenced alert_event.scope, which
-- does not exist — the column is `platform`. mon_resolve(p_kind, p_platform) takes the platform, so
-- the clear-on-recovery loop must read `platform` and pass it through. Caught immediately by
-- executing the detector rather than trusting the apply: `select ... from mon_detect_refresh_coverage()`
-- failed with 42703 on the first real call, before any scheduled run used it.
create or replace function public.mon_detect_refresh_coverage()
 returns table(platform text, active_rows bigint, refreshed bigint, coverage_pct numeric, window_hours integer, severity text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare rec record; t text; win int; a bigint; r bigint; tot_a bigint; tot_r bigint; pct numeric; sev text;
        seen text[] := '{}'; gone text;
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

  -- clear platforms that have recovered (alert_event.platform, not .scope)
  for gone in
    select distinct ae.platform from public.alert_event ae
     where ae.kind = 'refresh_coverage' and ae.resolved_at is null
  loop
    if not (gone = any(seen)) then
      perform public.mon_resolve('refresh_coverage', gone);
    end if;
  end loop;
end $function$;
