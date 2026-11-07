-- 🔧 2026-11-07 — heartbeat follow-up (CodeRabbit on #11138, answered here):
--  1. the CHECK accepted an enabled, checked row with NULL window_hours (NULL > 0 passes a CHECK) → coalesce.
--  2. one broken row (renamed relation, bad ts_expr/filter_sql) aborted the whole detector and skipped the
--     stale-key resolve → each row is evaluated in its own block; a broken row raises P2 heartbeat_check_broken.
--  3. the proof read live `clicks` rows (fails on an empty/idle table) → this proof uses its own scratch table.

alter table public.ops_heartbeat_expectations drop constraint if exists ops_heartbeat_expectations_check;
alter table public.ops_heartbeat_expectations add constraint ops_heartbeat_expectations_check
  check (covered_by is not null or not enabled or stream = 'scrape_runs_per_platform'
         or (relation is not null and ts_expr is not null and coalesce(window_hours, 0) > 0));

create or replace function public.mon_detect_heartbeat_silent()
 returns integer
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  e record; n int := 0; v_cnt bigint; v_last timestamptz; v_key text; v_repair text;
  live_keys text[] := '{}'; v_roster text := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  v_kinds constant text[] := array['heartbeat_silent','heartbeat_silent_clicks','heartbeat_silent_crawl','heartbeat_silent_facts',
    'heartbeat_silent_lifecycle','heartbeat_silent_af','heartbeat_silent_new_listings','heartbeat_silent_engineer','heartbeat_cover_missing',
    'heartbeat_check_broken'];
  k text;
begin
  for e in select * from public.ops_heartbeat_expectations where enabled order by stream loop
    begin
      v_key := 'heartbeat_silent:' || e.stream;

      if e.covered_by is not null then
        -- covered: the named detector must exist AND be reached (roster or an active cron job), else it is decoration.
        if to_regproc('public.' || e.covered_by) is null
           or (position(e.covered_by in v_roster) = 0
               and not exists (select 1 from cron.job j where j.active and position(e.covered_by in j.command) > 0)) then
          v_key := 'heartbeat_cover_missing:' || e.stream;
          live_keys := live_keys || v_key;
          n := n + public.mon_raise('P2', 'heartbeat_cover_missing', 'heartbeat', v_key, jsonb_build_object(
            'stream', e.stream, 'covered_by', e.covered_by, 'for', '🔧',
            'why', 'The heartbeat list says this stream is watched by ' || e.covered_by || ', but that detector no longer exists or nothing runs it. A stream nobody watches goes silent unseen (clicks, 5 months).',
            'action', 'Restore the detector onto mon_run_all_detectors (or a cron job), or give this row its own relation/ts_expr/window and clear covered_by.'));
        end if;
        continue;
      end if;

      if e.stream = 'scrape_runs_per_platform' then
        -- active source platforms with NO capture run at all for window_hours (the gap silent_scraper_death leaves).
        -- one pass over the recent runs (not one scan per platform); a platform absent from it is silent.
        for v_last, k in
          with recent as (
            select s.platform, max(s.started_at) as last_at from public.scrape_runs s
             where s.started_at > now() - interval '30 days' and s.platform !~ ':' group by s.platform)
          select max(r.last_at), pr.platform
            from public.platform_registry pr
            left join recent r on (r.platform = pr.platform or r.platform like pr.platform || '\_%')
           where pr.status = 'active' and pr.kind = 'source'
           group by pr.platform
        loop
          if v_last is null or v_last < now() - make_interval(hours => e.window_hours::int) then
            v_key := 'heartbeat_silent:scrape_runs_per_platform:' || k;
            live_keys := live_keys || v_key;
            n := n + public.mon_raise('P1', e.alert_kind, k, v_key, jsonb_build_object(
              'stream', 'scrape_runs (' || k || ')', 'last_row_at', v_last, 'window_hours', e.window_hours, 'for', '⚡',
              'why', 'An active platform has not run at all for ' || e.window_hours || ' h — its scheduler stopped, so silent_scraper_death no longer sees it.',
              'action', 'Find why its workflow/cron stopped (gh run list, cron.job) and re-dispatch it; if the platform is retired, change platform_registry.'));
          end if;
        end loop;
        continue;
      end if;

      execute format('select count(*) from (select 1 from public.%I where %s > now() - make_interval(secs => %s) and (%s) limit %s) t',
                     e.relation, e.ts_expr, (e.window_hours * 3600)::bigint, coalesce(e.filter_sql, 'true'), e.min_rows)
        into v_cnt;
      if v_cnt >= e.min_rows then continue; end if;

      execute format('select max(%s) from public.%I where (%s)', e.ts_expr, e.relation, coalesce(e.filter_sql, 'true')) into v_last;
      live_keys := live_keys || v_key;
      v_repair := null;
      -- repair first, once: only when this stream is not already open (never re-dispatch every half hour).
      if e.repair_sql is not null
         and not exists (select 1 from public.alert_event where dedup_key = v_key and resolved_at is null) then
        begin
          execute e.repair_sql;
          v_repair := 'ran: ' || e.repair_sql;
        exception when others then
          v_repair := 'failed: ' || sqlerrm;
        end;
      end if;
      n := n + public.mon_raise('P1', e.alert_kind, 'heartbeat', v_key, jsonb_build_object(
        'stream', e.stream, 'last_row_at', v_last, 'rows_in_window', v_cnt, 'min_rows', e.min_rows,
        'window_hours', e.window_hours, 'measured', e.measured, 'repair', v_repair,
        'why', e.stream || ' wrote ' || v_cnt || ' row(s) in the last ' || e.window_hours || ' h (floor ' || e.min_rows
            || '); last row ' || coalesce(v_last::text, 'never') || '. A stream that stops moving is a silent failure — clicks were refused for 5 months and nothing alarmed.',
        'action', 'Find the writer (app, workflow, cron) and the error it is getting; fix it end to end and prove a new row lands. If the stream is truly retired, set enabled = false on its ops_heartbeat_expectations row with the reason.'));
    exception when others then
      -- one broken row (renamed relation, bad ts_expr/filter) must not blind the rest of the list (CodeRabbit #11138).
      v_key := 'heartbeat_check_broken:' || e.stream;
      live_keys := live_keys || v_key;
      n := n + public.mon_raise('P2', 'heartbeat_check_broken', 'heartbeat', v_key, jsonb_build_object(
        'stream', e.stream, 'error', sqlerrm, 'for', '🔧',
        'why', 'This heartbeat row cannot be evaluated, so its stream is unwatched.',
        'action', 'Fix relation / ts_expr / filter_sql on its ops_heartbeat_expectations row, or set enabled = false with the reason.'));
    end;
  end loop;

  foreach k in array v_kinds loop
    perform public.mon_resolve_stale_keys(k, live_keys);
  end loop;
  return n;
end $function$;
revoke all on function public.mon_detect_heartbeat_silent() from public, anon, authenticated;
grant execute on function public.mon_detect_heartbeat_silent() to service_role;

-- PROOF on a scratch table (no live data): silent → P1 naming the stream; moving → resolved; a broken row → P2 and the
-- rest of the list is still evaluated; NULL window rejected; all rolled back.
do $$
declare d jsonb;
begin
  begin
    create table public.__hb_selftest (at timestamptz);
    insert into public.ops_heartbeat_expectations (stream, relation, ts_expr, window_hours, min_rows, alert_kind, measured)
    values ('__selftest_a_broken__', '__no_such_relation__', 'at', 1, 1, 'heartbeat_silent', 'selftest'),
           ('__selftest_b_silent__', '__hb_selftest', 'at', 1, 1, 'heartbeat_silent_clicks', 'selftest');
    perform public.mon_detect_heartbeat_silent();
    if not exists (select 1 from public.alert_event where dedup_key = 'heartbeat_check_broken:__selftest_a_broken__' and resolved_at is null) then
      raise exception 'PROOF: a broken row did not raise heartbeat_check_broken';
    end if;
    select detail into d from public.alert_event where dedup_key = 'heartbeat_silent:__selftest_b_silent__' and resolved_at is null and severity = 'P1';
    if d is null or d->>'stream' <> '__selftest_b_silent__' or not (d ? 'last_row_at') then
      raise exception 'PROOF: the stream after a broken row was not evaluated / not raised: %', d;
    end if;
    insert into public.__hb_selftest values (now());
    perform public.mon_detect_heartbeat_silent();
    if exists (select 1 from public.alert_event where dedup_key = 'heartbeat_silent:__selftest_b_silent__' and resolved_at is null) then
      raise exception 'PROOF: the stream moved again but the P1 stayed open';
    end if;
    begin
      insert into public.ops_heartbeat_expectations (stream, relation, ts_expr, measured) values ('__selftest_c_nowindow__', 'clicks', 'created_at', 'selftest');
      raise exception 'PROOF: an enabled row without window_hours was accepted';
    exception when check_violation then null;
    end;
    raise exception '__heartbeat_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__heartbeat_selftest_rollback__' then raise; end if;
  end;
  if to_regclass('public.__hb_selftest') is not null then raise exception 'PROOF: scratch table not rolled back'; end if;
  perform public.mon_detect_heartbeat_silent();
  raise notice 'PROOF: broken row isolated (P2), next stream still raised and resolved, NULL window rejected, rolled back';
end $$;
