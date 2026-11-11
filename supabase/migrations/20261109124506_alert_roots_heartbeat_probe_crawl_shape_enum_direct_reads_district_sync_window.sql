-- 2026-11-09 — five open alerts, five roots (autonomous run, owner: «fix it now»).
--
-- 1. heartbeat_silent:agent_health_event. The writer is healthy (a smoke request at 12:22 UTC landed a row
--    in 0.3 s). The stream is written ONLY when somebody asks the AI Agent, so a quiet night (20 h, Sunday
--    into Monday) read as a dead writer. A heartbeat that depends on a human asking is not a heartbeat.
--    → agent_heartbeat_probe(): one real Arabic request to the live function every 6 h (pg_net), the same
--      request scripts/agent-surface.sh smoke sends. A broken function writes no row → the alert still
--      fires; a quiet night no longer does. It is also the row's repair_sql, so the detector probes once
--      before paging.
-- 2. unresolvable_alert_kind:heartbeat_silent. mon_detect_heartbeat_silent DOES resolve its kinds, but through
--    `foreach k in array v_kinds loop perform mon_resolve_stale_keys(k, …)`, and the unresolvable-kind
--    detector (correctly) accepts only a LITERAL kind in the call. → ten literal calls, one per kind.
-- 3. crawl_went_silent:gathern_liveness / wasalt_enum_shard. The detector judged ONE run against the label's
--    median run. gathern_liveness drains a due-queue (2 … 1,500 rows an hour), wasalt_enum_shard is one
--    category per run (farm/rent = 0, room/sale = 30,000); the latest shard is never the crawl. The gathern
--    row that fired was a no-op («apply skipped — lock held», 0 rows) left by a lost GitHub runner.
--    → shape-aware: a label with ≤ 2 runs a day (dwelleo, sakani) is judged per run as before (Dwelleo
--      6,996 → 0 still fires the same hour); a label with > 2 runs a day is judged on the trailing 24 h SUM
--      against the median of its complete prior days. No-op rows (lock held) and SIGINT kills never count as
--      "the latest crawl" (run_killed_by_timeout owns a kill).
-- 4. enumeration_incomplete:superoffice. The platform respects robots.txt (owner decision 4, 2026-11-03), so its
--    server-rendered window can never list the whole catalogue and the prune guard trips by design — and
--    then the run reads EVERY unseen office's own page (strike_read_gone). The detector saw only «prune guard
--    tripped» and reported «delisted ads are NOT being retired», which is false there. → end_run() now writes
--    «unseen read directly: <table> unseen=U read=R gone=G live=L unknown=K unread=X» (scrapers/common/db.py);
--    a run whose every tripped table reads unread=0 is a partial WALK with a complete direct VERDICT and is
--    not raised. unread>0 or no marker → raised exactly as before (raghdan shape unchanged).
-- 5. served_district_not_offered (3 reopens / 7 days). The search sync writes at :22, the district list rebuilds
--    at :50, the detector runs at 04:36 — inside the 28-minute window in which a just-synced ad is served but
--    the list has not yet had a chance to offer it. Every reopen was a word the :50 rebuild then added.
--    → an ad changed AFTER the list's last build is judged only once the list has rebuilt (gate active only
--      while the last build is < 2 h old, so a stalled rebuild still exposes everything).

-- ── 1. the AI Agent gets a real heartbeat ───────────────────────────────────────────────────────────────────
create or replace function public.agent_heartbeat_probe()
returns bigint
language plpgsql
security definer
set search_path to 'public', 'net'
as $$
declare v_id bigint;
begin
  -- The publishable key is public by design (it is in the web bundle and in scripts/agent-surface.sh).
  -- The body is the smoke request: a real Arabic search the function must classify.
  select net.http_post(
    url := 'https://aannarbkwcymrotzwdbo.supabase.co/functions/v1/agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB',
      'Authorization', 'Bearer sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB'),
    body := jsonb_build_object('text', 'شقق للايجار السنوي في الرياض', 'locale', 'ar', 'loggedIn', false,
                               'order', 'newest', 'history', '[]'::jsonb),
    timeout_milliseconds := 30000)
    into v_id;
  return v_id;
end $$;

comment on function public.agent_heartbeat_probe() is
  'One real request to the live AI Agent (the scripts/agent-surface.sh smoke body). A healthy function writes '
  'agent_health_event + ai_usage rows; a broken one writes nothing and heartbeat_silent:agent_health_event fires. '
  'Scheduled every 6 h (cron agent-heartbeat-probe) and the stream''s repair_sql (2026-11-09).';

select cron.unschedule(jobid) from cron.job where jobname = 'agent-heartbeat-probe';
select cron.schedule('agent-heartbeat-probe', '11 */6 * * *', $j$select public.agent_heartbeat_probe()$j$);

update public.ops_heartbeat_expectations
   set repair_sql = 'select public.agent_heartbeat_probe()',
       measured = '14 d: 4–51 rows/day from users, largest gap 20 h on a quiet Sunday night (2026-11-08/09). Since '
                  '2026-11-09 agent_heartbeat_probe() asks the live function every 6 h, so the floor no longer '
                  'depends on a human asking; a broken function still writes nothing.'
 where stream = 'agent_health_event';

-- ── 2. heartbeat_silent is provably resolvable: literal kinds ──────────────────────────────────────────────
create or replace function public.mon_detect_heartbeat_silent()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  e record; n int := 0; v_cnt bigint; v_last timestamptz; v_key text; v_repair text;
  live_keys text[] := '{}'; v_roster text := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
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
      -- keep this stream's open P1s live: an unevaluable stream is not a recovered one.
      live_keys := live_keys || array(select a.dedup_key from public.alert_event a where a.resolved_at is null
        and (a.dedup_key = 'heartbeat_silent:' || e.stream or a.dedup_key like 'heartbeat_silent:' || e.stream || ':%'));
      v_key := 'heartbeat_check_broken:' || e.stream;
      live_keys := live_keys || v_key;
      n := n + public.mon_raise('P2', 'heartbeat_check_broken', 'heartbeat', v_key, jsonb_build_object(
        'stream', e.stream, 'error', sqlerrm, 'for', '🔧',
        'why', 'This heartbeat row cannot be evaluated, so its stream is unwatched.',
        'action', 'Fix relation / ts_expr / filter_sql on its ops_heartbeat_expectations row, or set enabled = false with the reason.'));
    end;
  end loop;

  -- One LITERAL call per kind (2026-11-09): mon_detect_unresolvable_alert_kinds proves resolvability by the literal in
  -- the call, and a loop over an array read as «nothing can clear heartbeat_silent». Same keys, same sweep.
  perform public.mon_resolve_stale_keys('heartbeat_silent', live_keys);
  perform public.mon_resolve_stale_keys('heartbeat_silent_clicks', live_keys);
  perform public.mon_resolve_stale_keys('heartbeat_silent_crawl', live_keys);
  perform public.mon_resolve_stale_keys('heartbeat_silent_facts', live_keys);
  perform public.mon_resolve_stale_keys('heartbeat_silent_lifecycle', live_keys);
  perform public.mon_resolve_stale_keys('heartbeat_silent_af', live_keys);
  perform public.mon_resolve_stale_keys('heartbeat_silent_new_listings', live_keys);
  perform public.mon_resolve_stale_keys('heartbeat_silent_engineer', live_keys);
  perform public.mon_resolve_stale_keys('heartbeat_cover_missing', live_keys);
  perform public.mon_resolve_stale_keys('heartbeat_check_broken', live_keys);
  return n;
end $function$;

do $$
begin
  if pg_get_functiondef('public.mon_detect_heartbeat_silent()'::regprocedure) !~ 'mon_resolve_stale_keys\s*\(\s*''heartbeat_silent''' then
    raise exception 'PROOF: heartbeat_silent is still not resolved by a literal call';
  end if;
end $$;

-- ── 3. crawl_went_silent compares like with like ───────────────────────────────────────────────────────────
create or replace function public.mon_detect_crawl_went_silent()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; live text[] := '{}'; r record;
begin
  for r in
    with ap as (
      select platform from public.platform_registry where status = 'active' and kind = 'source'
    ), runs as (
      select ap.platform, s.platform as label, s.started_at, s.ok, coalesce(s.rows_seen, 0) as rows_seen, s.notes
        from ap join public.scrape_runs s on (s.platform = ap.platform or s.platform like ap.platform || '\_%')
       where s.platform !~ ':'
         and s.platform !~ '_enrich'          -- a backfill's rows_seen is its backlog: 0 is a done job
         and s.started_at > now() - interval '8 days'
         and s.finished_at is not null
         -- a no-op (another run held the write lock) or a kill is not a crawl that saw 0 ads:
         -- run_killed_by_timeout owns the kill; the lock-skip row carries no reading at all (2026-11-09).
         and coalesce(s.notes, '') !~ 'apply skipped — lock held|killed by SIGINT before end_run'
         and not exists (select 1 from public.ops_platform_catalogue_rebase cr
                          where cr.platform = ap.platform and s.started_at < cr.rebased_at)
    ), shape as (
      -- ≤ 2 runs a day: each run IS the crawl (dwelleo, sakani). More: the crawl is the DAY — per-shard
      -- categories (wasalt_enum_shard: farm/rent 0 … room/sale 30,000) or a due-queue drained hourly
      -- (gathern_liveness: 2 … 1,500 rows); the latest run alone says nothing about the catalogue.
      select label, count(*)::numeric / greatest(count(distinct started_at::date), 1) as runs_per_day
        from runs group by label
    ), last as (
      select distinct on (label) * from runs order by label, started_at desc
    ), whole as (
      select l.platform, l.label, l.started_at, l.ok, l.rows_seen, l.notes, b.median_rows, b.healthy_runs, 'run' as unit
        from last l join shape sh using (label)
        join lateral (select percentile_cont(0.5) within group (order by x.rows_seen)::numeric as median_rows, count(*) as healthy_runs
                        from runs x where x.label = l.label and x.ok and x.rows_seen > 0 and x.started_at < l.started_at) b on true
       where sh.runs_per_day <= 2
         and b.median_rows >= 1000
         and l.rows_seen < 0.05 * b.median_rows
         and l.started_at > now() - interval '36 hours'
    ), sharded as (
      select l.platform, l.label, l.started_at, l.ok, d.sum24 as rows_seen, l.notes, b.median_rows, b.healthy_runs, 'trailing 24 h' as unit
        from last l join shape sh using (label)
        join lateral (select coalesce(sum(x.rows_seen), 0) as sum24 from runs x
                        where x.label = l.label and x.started_at > now() - interval '24 hours') d on true
        join lateral (select percentile_cont(0.5) within group (order by t.daysum)::numeric as median_rows, count(*) as healthy_runs
                        from (select x.started_at::date as d, sum(x.rows_seen) as daysum from runs x
                               where x.label = l.label and x.ok and x.started_at::date < current_date group by 1) t
                       where t.daysum > 0) b on true
       where sh.runs_per_day > 2
         and b.median_rows >= 1000
         and d.sum24 < 0.05 * b.median_rows
         and l.started_at > now() - interval '36 hours'
    )
    select * from whole union all select * from sharded
  loop
    live := live || ('crawl_went_silent:' || r.label);
    n := n + public.mon_raise('P1', 'crawl_went_silent', r.platform, 'crawl_went_silent:' || r.label,
      jsonb_build_object('label', r.label, 'unit', r.unit, 'last_run_at', r.started_at, 'last_ok', r.ok, 'last_rows_seen', r.rows_seen,
        'median_rows_8d', r.median_rows, 'healthy_runs_8d', r.healthy_runs, 'last_notes', left(r.notes, 300), 'for', '⚡',
        'why', 'This crawl''s latest ' || r.unit || ' saw under 5% of what its own healthy ' || r.unit || 's see (Dwelleo 6,996 → 0 on '
            || '2026-11-04 paged nobody until the next day). Read last_notes, then the source in a rendered browser '
            || '(four places). If the source really shrank, record it in ops_platform_catalogue_rebase with the '
            || 'evidence; if not, fix the crawl. Its prune guard is holding the old ads meanwhile.'));
  end loop;
  perform public.mon_resolve_stale_keys('crawl_went_silent', live);
  return n;
end $function$;

-- PROOF (rolled back): the Dwelleo shape still fires the same hour; one small shard of a many-shard day does not;
-- a whole silent day of shards does; a lock-held no-op row is not a reading.
do $proof$
declare victim text; v_open int;
begin
  select platform into victim from public.platform_registry where status = 'active' and kind = 'source'
    and not exists (select 1 from public.ops_platform_catalogue_rebase cr where cr.platform = platform_registry.platform)
   order by platform limit 1;
  if victim is null then raise exception 'PROOF: no platform to plant on'; end if;
  begin
    -- (a) daily label: 8 healthy runs of 6,996 then a 0-row run → fires
    insert into public.scrape_runs (platform, started_at, finished_at, ok, rows_seen, rows_upserted, notes)
      select victim || '_zzdaily', now() - (d || ' days')::interval, now() - (d || ' days')::interval + interval '10 min', true, 6996, 10, 'ok'
        from generate_series(1, 7) d;
    insert into public.scrape_runs (platform, started_at, finished_at, ok, rows_seen, rows_upserted, notes)
      values (victim || '_zzdaily', now() - interval '20 min', now() - interval '10 min', false, 0, 0, 'the catalogue API answered with no properties');
    -- (b) sharded label: 12 shards a day for 7 days (sizes 5 … 30,000), today 11 shards already in, latest shard 5 rows → quiet
    insert into public.scrape_runs (platform, started_at, finished_at, ok, rows_seen, rows_upserted, notes)
      select victim || '_zzshard', now() - (d || ' days')::interval - (h || ' hours')::interval,
             now() - (d || ' days')::interval - (h || ' hours')::interval + interval '5 min', true,
             case h % 4 when 0 then 5 when 1 then 235 when 2 then 1950 else 30000 end, 1, 'upserted'
        from generate_series(1, 7) d, generate_series(1, 12) h;
    insert into public.scrape_runs (platform, started_at, finished_at, ok, rows_seen, rows_upserted, notes)
      select victim || '_zzshard', now() - (h || ' hours')::interval, now() - (h || ' hours')::interval + interval '5 min', true,
             case h % 4 when 0 then 5 when 1 then 235 when 2 then 1950 else 30000 end, 1, 'upserted'
        from generate_series(1, 11) h;
    insert into public.scrape_runs (platform, started_at, finished_at, ok, rows_seen, rows_upserted, notes)
      values (victim || '_zzshard', now() - interval '10 min', now() - interval '9 min', true, 5, 5, 'upserted=5');
    -- (c) sharded label whose whole last 24 h is silent → fires
    insert into public.scrape_runs (platform, started_at, finished_at, ok, rows_seen, rows_upserted, notes)
      select victim || '_zzdead', now() - (d || ' days')::interval - (h || ' hours')::interval,
             now() - (d || ' days')::interval - (h || ' hours')::interval + interval '5 min', true, 2000, 1, 'upserted'
        from generate_series(2, 8) d, generate_series(1, 12) h;
    insert into public.scrape_runs (platform, started_at, finished_at, ok, rows_seen, rows_upserted, notes)
      select victim || '_zzdead', now() - (h || ' hours')::interval, now() - (h || ' hours')::interval + interval '1 min', true, 0, 0, 'upserted=0'
        from generate_series(1, 12) h;
    -- (d) daily label whose latest row is a lock-held no-op → not a reading, must not fire
    insert into public.scrape_runs (platform, started_at, finished_at, ok, rows_seen, rows_upserted, notes)
      select victim || '_zzlock', now() - (d || ' days')::interval, now() - (d || ' days')::interval + interval '10 min', true, 6996, 10, 'ok'
        from generate_series(1, 7) d;
    insert into public.scrape_runs (platform, started_at, finished_at, ok, rows_seen, rows_upserted, notes)
      values (victim || '_zzlock', now() - interval '20 min', now() - interval '19 min', true, 0, 0, 'apply skipped — lock held ({...})');

    perform public.mon_detect_crawl_went_silent();
    select count(*) into v_open from public.alert_event where dedup_key = 'crawl_went_silent:' || victim || '_zzdaily' and resolved_at is null;
    if v_open <> 1 then raise exception 'PROOF: the Dwelleo shape (daily 6,996 → 0) did not raise'; end if;
    select count(*) into v_open from public.alert_event where dedup_key = 'crawl_went_silent:' || victim || '_zzshard' and resolved_at is null;
    if v_open <> 0 then raise exception 'PROOF: a 5-row shard of a healthy many-shard day raised'; end if;
    select count(*) into v_open from public.alert_event where dedup_key = 'crawl_went_silent:' || victim || '_zzdead' and resolved_at is null;
    if v_open <> 1 then raise exception 'PROOF: a sharded crawl whose whole day is silent did not raise'; end if;
    select count(*) into v_open from public.alert_event where dedup_key = 'crawl_went_silent:' || victim || '_zzlock' and resolved_at is null;
    if v_open <> 0 then raise exception 'PROOF: a lock-held no-op row was read as a silent crawl'; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  if exists (select 1 from public.scrape_runs where platform like victim || '_zz%') then
    raise exception 'PROOF: scratch runs were not rolled back';
  end if;
end $proof$;

-- ── 4. enumeration_incomplete: a partial walk with a complete direct verdict is not stale inventory ─────────
create or replace function public.mon_detect_enumeration_incomplete()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int := 0; live text[] := '{}'; r record;
begin
  for r in
    with hits as (
      select split_part(platform, ':', 1) as fam, started_at, rows_seen, notes,
             -- «unseen read directly: <table> … unread=X» per tripped table (scrapers/common/db.py end_run, 2026-11-09).
             -- Covered = every tripped table carries the marker AND none left an unseen row unread.
             (select count(*) from regexp_matches(coalesce(notes, ''), '_listings (collapse|coverage) \(', 'g')) as tripped_tables,
             (select count(*) from regexp_matches(coalesce(notes, ''), 'unseen read directly: ', 'g')) as read_markers,
             coalesce(notes, '') ~ 'unread=[1-9][0-9]*' as left_unread
        from public.scrape_runs
       where started_at >= now() - interval '72 hours'
         and notes ~* 'harvest incomplete|enumeration incomplete|prune withheld|prune guard tripped'
    )
    select fam, count(*) as runs, max(started_at) as last_seen, max(rows_seen) as best_rows_seen,
           count(*) filter (where tripped_tables > 0 and read_markers >= tripped_tables and not left_unread) as covered_runs
      from hits
     group by 1
    having count(*) > count(*) filter (where tripped_tables > 0 and read_markers >= tripped_tables and not left_unread)
     order by 2 desc
  loop
    live := live || ('enumeration_incomplete:' || r.fam);
    n := n + public.mon_raise('P1', 'enumeration_incomplete', r.fam,
      'enumeration_incomplete:' || r.fam,
      jsonb_build_object('runs_72h', r.runs, 'last_seen', r.last_seen,
        'best_rows_seen', r.best_rows_seen, 'runs_with_every_unseen_row_read', r.covered_runs,
        'why', 'this platform could not enumerate its full catalogue, so the run deliberately '
            || 'WITHHELD pruning rather than inactivate listings it simply never visited. That '
            || 'choice is correct and nothing is lost — but the run still reports ok=true with '
            || 'rows upserted, so no failure-based or count-based barrier can see it. While this '
            || 'persists, delisted ads are NOT being retired and the platform slowly fills with '
            || 'stale inventory. (A run that then read EVERY unseen row''s own page — notes carry '
            || '«unseen read directly: … unread=0» — is a partial walk with a complete verdict and is '
            || 'not counted here.)',
        'adjudicate', 'Fix the ENUMERATION, never the guard. Do not "resolve" this by allowing the '
            || 'prune to run on a short crawl - that is the raghdan under-enumeration shape and it '
            || 'inactivates live listings. For souq24 specifically, read the harvest line in the '
            || 'job log: it prints pages visited/total, elapsed, failures and the budget, which '
            || 'says immediately whether the source got slower or the page list got bigger.'));
  end loop;
  perform public.mon_resolve_stale_keys('enumeration_incomplete', live);
  return n;
end $function$;

-- PROOF (rolled back): a tripped guard with no direct reads raises; with every unseen row read it does not;
-- with one unseen row left unread it raises.
do $proof$
declare v_open int;
begin
  begin
    insert into public.scrape_runs (platform, started_at, finished_at, ok, rows_seen, rows_upserted, notes) values
      ('zzproof_bare', now() - interval '1 hour', now() - interval '59 min', true, 24, 22,
       'prune guard tripped: zzproof_bare_commercial_listings coverage (re-saw 22 of 28 active, floor 80%)'),
      ('zzproof_read', now() - interval '1 hour', now() - interval '59 min', true, 24, 22,
       'prune guard tripped: zzproof_read_commercial_listings coverage (re-saw 22 of 28 active, floor 80%) | unseen read directly: zzproof_read_commercial_listings unseen=6 read=6 gone=1 live=4 unknown=1 unread=0'),
      ('zzproof_part', now() - interval '1 hour', now() - interval '59 min', true, 24, 22,
       'prune guard tripped: zzproof_part_commercial_listings coverage (re-saw 22 of 28 active, floor 80%) | unseen read directly: zzproof_part_commercial_listings unseen=60 read=50 gone=1 live=40 unknown=9 unread=10');
    perform public.mon_detect_enumeration_incomplete();
    select count(*) into v_open from public.alert_event where dedup_key = 'enumeration_incomplete:zzproof_bare' and resolved_at is null;
    if v_open <> 1 then raise exception 'PROOF: a tripped guard with no direct reads did not raise'; end if;
    select count(*) into v_open from public.alert_event where dedup_key = 'enumeration_incomplete:zzproof_read' and resolved_at is null;
    if v_open <> 0 then raise exception 'PROOF: a tripped guard whose every unseen row was read directly raised'; end if;
    select count(*) into v_open from public.alert_event where dedup_key = 'enumeration_incomplete:zzproof_part' and resolved_at is null;
    if v_open <> 1 then raise exception 'PROOF: a tripped guard that left unseen rows unread did not raise'; end if;
    raise exception 'ROLLBACK_REVERT';
  exception when others then
    if sqlerrm <> 'ROLLBACK_REVERT' then raise; end if;
  end;
  if exists (select 1 from public.scrape_runs where platform like 'zzproof_%') then
    raise exception 'PROOF: scratch runs were not rolled back';
  end if;
end $proof$;

-- ── 5. served_district_not_offered judges only what the list has had a chance to see ───────────────────────
create or replace function public.served_district_not_offered()
 returns table(platform text, city_id integer, city_ar text, district_ar text, ads bigint, list_rule text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with clus as (
    select c1.city_id, m.city_id as member
      from public.loc_city_cluster c1 join public.loc_city_cluster m on m.cluster_key = c1.cluster_key
  ), built as (
    -- the list's last build; the gate below is active only while that build is recent (< 2 h), so a
    -- rebuild that stalls still exposes every served word (2026-11-09: 3 reopens in 7 days were all ads
    -- synced at :22 and judged at 04:36, before the :50 rebuild could offer them).
    select max(refreshed_at) as at from public.loc_canonical_district
  ), miss as (
    select s.platform, s.city_id, s.city_ar, s.district_ar,
           -- the reasons the LIST refuses a served word: the `liv` arm of refresh_loc_canonical_district(), verbatim
           case
             when s.district_ar in ('غير محدد','اخرى','أخرى') then 'placeholder'
             when public.district_ar_looks_bogus(s.district_ar) then 'bogus_shape'
             when s.district_ar ~ '[0-9٠-٩]' and s.district_ar !~ '^[^0-9٠-٩]+\s[0-9٠-٩]+$' then 'digit'
             when exists (select 1 from public.district_recovery dr
                           where dr.source_table = s.source_table and dr.listing_id = s.listing_id
                             and dr.verbatim is false) then 'rewritten_recovery'
           end as list_rule
      from public.search_listings_ar s, built
     where s.production_ready and s.city_id is not null and btrim(coalesce(s.district_ar, '')) <> ''
       and not (built.at > now() - interval '2 hours' and coalesce(s.last_updated, s.first_seen_at) > built.at)
       and not exists (select 1 from public.loc_canonical_district c
                        where c.city_id = s.city_id and c.district_norm = s.district_norm_tok)
       and not exists (select 1 from clus join public.loc_canonical_district c on c.city_id = clus.member
                        where clus.city_id = s.city_id and c.district_norm = s.district_norm_tok)
  )
  select platform, city_id, city_ar, district_ar, count(*) as ads, list_rule
    from miss group by platform, city_id, city_ar, district_ar, list_rule;
$function$;

do $$
begin
  if pg_get_functiondef('public.served_district_not_offered()'::regprocedure) !~ 'built\.at > now\(\) - interval ''2 hours''' then
    raise exception 'PROOF: the sync-window gate did not land';
  end if;
end $$;

-- Re-evaluate the open findings against the corrected predicates (a detector run, not a hand resolve).
select public.mon_detect_crawl_went_silent();
select public.mon_detect_enumeration_incomplete();
select public.mon_detect_served_district_not_offered();
select public.mon_detect_unresolvable_alert_kinds();
