-- 🔧 2026-11-07 — HEARTBEAT FOR EVERY DATA STREAM (owner: «I don't like experiencing silent issues like this — we need
-- something so we don't»). Every customer click from 2026-06-18 was refused (HTTP 409, a stale FK, dropped by the
-- clicks_drop_legacy_listing_fk migration), the app swallowed the error, and `clicks` sat at 33 rows for five months with NOTHING alarmed.
-- Same class before: Dwelleo 6,996 → 0 ads (2026-11-04), 37,000 licences stored but never shown.
--
-- ONE list (ops_heartbeat_expectations) names every stream that should keep moving. A row is either
--   * CHECKED here: fewer than min_rows rows within window_hours → P1 naming the stream and its last row time, or
--   * COVERED by an existing detector (covered_by): registered, not duplicated — and this detector proves that the
--     named detector still exists and is still reached (on mon_run_all_detectors or in an active cron job), or
--   * RETIRED (enabled = false) with the reason.
-- Windows/floors were measured from the last 14 days of production (2026-10-24 → 11-07): window ≈ 1.5–2 × the
-- largest gap seen between rows, floor = 1 row (a heartbeat), plus a volume floor where a trickle would still be
-- a failure (scrape_runs: min day 1,166 runs → 580 per 24 h).
-- Repair first where it is mechanical: repair_sql runs once when a stream first goes silent (e.g. re-dispatch the
-- AI reader's workflow), the P1 is still raised, and the result is recorded in the alert.
-- Rule (docs/ops/QUALITY_REPAIR_ENGINEER.md): every new data stream is added to this list in the same PR.

create table if not exists public.ops_heartbeat_expectations (
  stream        text primary key,
  relation      text,                  -- public table/view the check reads (null for covered/special rows)
  ts_expr       text,                  -- timestamp expression on that relation
  filter_sql    text,                  -- optional extra predicate
  window_hours  numeric,
  min_rows      int not null default 1,
  alert_kind    text not null default 'heartbeat_silent',
  covered_by    text,                  -- existing detector that already watches this stream (registered, not duplicated)
  repair_sql    text,                  -- mechanical repair, run once when the stream first goes silent
  enabled       boolean not null default true,
  measured      text not null,         -- what the 14-day measurement showed (the floor's evidence)
  check (covered_by is not null or not enabled or (relation is not null and ts_expr is not null and window_hours > 0) or stream = 'scrape_runs_per_platform')
);
comment on table public.ops_heartbeat_expectations is
  'ONE list of every data stream that should keep moving (owner 2026-11-07, clicks silent 5 months). Checked by mon_detect_heartbeat_silent() on the roster, or covered_by an existing detector it proves is still reached. Every new data stream is added here in the same PR.';
revoke all on table public.ops_heartbeat_expectations from public, anon, authenticated;
grant select, insert, update, delete on table public.ops_heartbeat_expectations to service_role;

insert into public.ops_heartbeat_expectations
  (stream, relation, ts_expr, filter_sql, window_hours, min_rows, alert_kind, covered_by, repair_sql, enabled, measured) values
-- checked here
('clicks', 'clicks', 'created_at', null, 72, 1, 'heartbeat_silent_clicks', null, null, true,
 '0 rows 2026-06-18 → 11-07 (every insert refused by a stale FK); first new row 21:13 UTC after the FK drop. Traffic is light (≈0–2 human «no results» a day) so 72 h; re-measure after 14 days of real clicks.'),
('ops_zero_result_log', 'ops_zero_result_log', 'at', null, 14, 1, 'heartbeat_silent', null, null, true,
 '14 d: 30–157 rows/day, largest gap 9.0 h (mostly CI robot journeys).'),
('scrape_runs', 'scrape_runs', 'started_at', null, 2, 1, 'heartbeat_silent_crawl', null, null, true,
 '14 d: 1,166–1,280 runs/day, largest gap 1.0 h.'),
('scrape_runs_volume_24h', 'scrape_runs', 'started_at', null, 24, 580, 'heartbeat_silent_crawl', null, null, true,
 '14 d: min day 1,166 runs; floor = half of it.'),
('scrape_runs_per_platform', null, null, null, 168, 1, 'heartbeat_silent_crawl', null, null, true,
 'Every active source platform ran within the last 24 h on 2026-11-07. mon_detect_silent_scraper_death covers 0–7 days (it drops a platform whose last attempt is older than 7 days); this row covers that gap: an active platform with no run at all for 7 days.'),
('listing_facts_runs', 'listing_facts_runs', 'at', null, 34, 1, 'heartbeat_silent_facts', null,
 $r$select public.trigger_gh_workflow('facts-extract.yml')$r$, true,
 '14 d: 132–16,883 rows/day from the daily 07:08 dispatch (cron gh-facts-ai-new), largest gap 22.4 h; 2026-10-24 had 0 rows.'),
('agent_health_event', 'agent_health_event', 'at', null, 15, 1, 'heartbeat_silent', null, null, true,
 '14 d: 4–51 rows/day, largest gap 9.8 h.'),
('ops_search_latency_sample', 'ops_search_latency_sample', 'sampled_at', null, 2, 1, 'heartbeat_silent', null, null, true,
 '14 d: 96–288 rows/day, largest gap 0.47 h.'),
('ops_liveness_coverage_snapshot', 'ops_liveness_coverage_snapshot', 'taken_at', null, 3, 1, 'heartbeat_silent_lifecycle', null, null, true,
 '14 d: ≈7,170 rows/day, largest gap 1.4 h.'),
('ops_stale_inactivation_probe', 'ops_stale_inactivation_probe', 'probed_at', null, 12, 1, 'heartbeat_silent_lifecycle', null, null, true,
 '14 d: 939–8,981 rows/day, largest gap 7.0 h.'),
('ops_dead_visible_score', 'ops_dead_visible_score', 'created_at', null, 36, 1, 'heartbeat_silent_lifecycle', null, null, true,
 '14 d: ≈144 rows/night, largest gap 24.4 h.'),
('ops_price_watch', 'ops_price_watch', 'seen_at', null, 36, 1, 'heartbeat_silent', null, null, true,
 '14 d: 575–1,517 rows/day, largest gap 23.0 h.'),
('ops_remediation_run', 'ops_remediation_run', 'ran_at', null, 1.5, 1, 'heartbeat_silent', null, null, true,
 '14 d: 92–96 rows/day (every 15 min), largest gap 0.5 h.'),
('ops_cron_bundle_step_run', 'ops_cron_bundle_step_run', 'started_at', null, 1.5, 1, 'heartbeat_silent', null, null, true,
 'Since 2026-11-04: ≈1,500 rows/day, largest gap 0.33 h.'),
('ops_af_score', 'ops_af_score', 'created_at', null, 36, 1, 'heartbeat_silent_af', null, null, true,
 '14 d: ≈144 rows/night, largest gap 23.9 h.'),
('ops_new_listings_score', 'ops_new_listings_score', 'created_at', null, 36, 1, 'heartbeat_silent_new_listings', null, null, true,
 '14 d: 18–43 rows/night, largest gap 24.2 h.'),
('welcome_posting_date_check', 'welcome_posting_date_check', 'checked_at', null, 36, 1, 'heartbeat_silent', null, null, true,
 'Since 2026-10-28: ≈33 rows/day, largest gap 24.0 h.'),
('ops_platform_side_daily', 'ops_platform_side_daily', 'day::timestamptz', null, 48, 1, 'heartbeat_silent', null, null, true,
 '14 d: ≈144 rows per day value, one per day (day = midnight, so 48 h).'),
('map_pins_daily', 'ops_platform_pin_daily', 'day::timestamptz', null, 48, 1, 'heartbeat_silent', null, null, true,
 '14 d: 84–86 platform rows per day (pins per platform per day), one per day.'),
('engineer:advanced_filter', 'ops_daily_engineer_run', 'run_at', $f$split_part(phase, ':', 1) = 'advanced_filter'$f$, 4, 1, 'heartbeat_silent_engineer', null, null, true,
 '14 d: 479 runs, largest gap 1.9 h.'),
('engineer:qa', 'ops_daily_engineer_run', 'run_at', $f$split_part(phase, ':', 1) = 'qa'$f$, 96, 1, 'heartbeat_silent_engineer', null, null, true,
 '14 d: 229 runs on 12 days, largest gap 71.6 h.'),
('engineer:lifecycle', 'ops_daily_engineer_run', 'run_at', $f$split_part(phase, ':', 1) = 'lifecycle'$f$, 96, 1, 'heartbeat_silent_engineer', null, null, true,
 '14 d: 128 runs on 12 days, largest gap 69.6 h.'),
('engineer:new_listings_engineer', 'ops_daily_engineer_run', 'run_at', $f$split_part(phase, ':', 1) = 'new_listings_engineer'$f$, 96, 1, 'heartbeat_silent_engineer', null, null, true,
 '14 d: 157 runs on 12 days, largest gap 72.3 h.'),
('engineer:scraping-engineer', 'ops_daily_engineer_run', 'run_at', $f$split_part(phase, ':', 1) = 'scraping-engineer'$f$, 96, 1, 'heartbeat_silent_engineer', null, null, true,
 '14 d: 97 runs on 12 days, largest gap 72.3 h.'),
('engineer:falcon', 'ops_daily_engineer_run', 'run_at', $f$split_part(phase, ':', 1) = 'falcon'$f$, 120, 1, 'heartbeat_silent_engineer', null, null, true,
 '14 d: 60 runs on 7 days (Tue + Fri), largest gap 96.9 h.'),
('engineer:click-guardian', 'ops_daily_engineer_run', 'run_at', $f$phase like 'click-guardian%'$f$, 48, 1, 'heartbeat_silent_engineer', null, null, false,
 'Lane created 2026-11-07, no run yet. Turn enabled on (and re-measure) once the 🔗 Click Guardian routine writes its first row.'),
-- covered by an existing detector (registered, not duplicated)
('listing_text_facts', null, null, null, null, 1, 'heartbeat_silent', 'mon_detect_text_facts', null, true,
 'Reader writes daily (14 d: 11–8,582 reads/day); mon_detect_text_facts flags max(read_at) older than 36 h (cron mon-text-facts 11:50).'),
('welcome_insight', null, null, null, null, 1, 'heartbeat_silent', 'mon_detect_welcome_insights_stale', null, true,
 'Built every 3 h (cron build-welcome-insights, 1 build/day recorded 14 of 14 days); stale detector at 3.5 h / 6.5 h; mon_detect_welcome_facts_missing_today covers the shown facts.'),
('ops_served_link_check', null, null, null, null, 1, 'heartbeat_silent', 'mon_detect_served_links_broken', null, true,
 '150 links a night since 2026-11-05; the detector flags a missing night after 36 h.'),
('ops_card_parity', null, null, null, null, 1, 'heartbeat_silent', 'mon_detect_card_parity', null, true,
 '150 rows a night; the detector flags a missing night after 30 h.'),
('search_listings_ar_sync', null, null, null, null, 1, 'heartbeat_silent', 'mon_detect_search_index_freshness', null, true,
 'Hourly sync (cron sync-search-listings-ar :22); P2 at 180 min lag / P1 at 360 min or a backlog.'),
('scrape_runs_rows_per_crawl', null, null, null, null, 1, 'heartbeat_silent', 'mon_detect_crawl_went_silent', null, true,
 'A crawl whose latest run sees < 5 % of its own healthy median (Dwelleo 6,996 → 0).'),
('scrape_runs_healthy_per_platform', null, null, null, null, 1, 'heartbeat_silent', 'mon_detect_silent_scraper_death', null, true,
 'No healthy run within max(2 × expected_hours, 24 h), while the platform is still being scheduled (≤ 7 days).'),
('scrape_alarm', null, null, null, null, 1, 'heartbeat_silent', 'mon_detect_scrape_alarm_silent', null, true,
 'The scrape alarm heartbeat row (8 h).'),
('alert_dispatch', null, null, null, null, 1, 'heartbeat_silent', 'mon_detect_alert_dispatch_silent', null, true,
 'The alert dispatcher heartbeat — a page that never leaves is silence too.'),
('detector_roster', null, null, null, null, 1, 'heartbeat_silent', 'mon_detect_cron_scheduler_frozen', null, true,
 'This list runs ON the roster, so it cannot see the roster itself stop; pg_cron freeze is watched there and by mon_detect_cron_health.'),
('daily_detector_gate', null, null, null, null, 1, 'heartbeat_silent', 'mon_detect_stalled_daily_detector', null, true,
 'The ~20 h gate of the expensive behavioural detectors (30 h).'),
-- retired / not reachable
('ops_qa_search_run', null, null, null, null, 1, 'heartbeat_silent', null, null, false,
 'Last row 2026-09-21 — written by the routines the owner deleted 2026-09-27.'),
('ops_routine_sentry_heartbeat', null, null, null, null, 1, 'heartbeat_silent', null, null, false,
 'Last row 2026-09-27 — the routines that wrote it were deleted that day. Sentry ingestion itself is not readable from the database; the app now reports refused writes to Sentry, and this list watches the rows those writes should create.'),
('ops_capacity_run', null, null, null, null, 1, 'heartbeat_silent', null, null, false,
 'On demand (1 run on 2026-11-05), not a stream.')
on conflict (stream) do nothing;

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
    'heartbeat_silent_lifecycle','heartbeat_silent_af','heartbeat_silent_new_listings','heartbeat_silent_engineer','heartbeat_cover_missing'];
  k text;
begin
  for e in select * from public.ops_heartbeat_expectations where enabled order by stream loop
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
  end loop;

  foreach k in array v_kinds loop
    perform public.mon_resolve_stale_keys(k, live_keys);
  end loop;
  return n;
end $function$;
revoke all on function public.mon_detect_heartbeat_silent() from public, anon, authenticated;
grant execute on function public.mon_detect_heartbeat_silent() to service_role;

-- Roster: needle-inserted into the LIVE definition (a full copy would clobber a peer's entry).
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_heartbeat_silent' in src) > 0 then
    raise notice 'mon_detect_heartbeat_silent already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_bedrooms_not_captured'',',
    E'    ''mon_detect_bedrooms_not_captured'',\n    ''mon_detect_heartbeat_silent'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Lanes: clicks → 🔗 Click Guardian; crawls → ⚡; facts / AF score → AF; lifecycle streams → lifecycle;
-- arrivals score → 🆕; the rest (and a silent engineer, a lost cover) → 🔧.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.ops_engineer_for_alert(text,text)'::regprocedure);
  if position('heartbeat_silent' in src) > 0 then
    raise notice 'ops_engineer_for_alert already routes heartbeat_silent';
    return;
  end if;
  out_def := replace(src,
    E'  select case\n',
    E'  select case\n'
    || E'    when p_kind = ''heartbeat_silent_clicks'' then ''click-guardian''\n'
    || E'    when p_kind = ''heartbeat_silent_crawl'' then ''scraping-engineer''\n'
    || E'    when p_kind in (''heartbeat_silent_facts'', ''heartbeat_silent_af'') then ''advanced_filter''\n'
    || E'    when p_kind = ''heartbeat_silent_lifecycle'' then ''lifecycle''\n'
    || E'    when p_kind = ''heartbeat_silent_new_listings'' then ''new_listings_engineer''\n');
  if out_def = src then
    raise exception 'ops_engineer_for_alert anchor not found — refusing to guess';
  end if;
  execute out_def;
end $$;

-- PROOF (mutation): a stream that stops writing raises a P1 naming it and its last row time, routed to its lane; the
-- same stream moving again resolves it; a cover pointing at a detector nothing runs raises P2; the live list is
-- printed; everything selftest is rolled back.
do $$
declare d jsonb; v_silent text;
begin
  if public.ops_engineer_for_alert('heartbeat_silent_clicks', null) <> 'click-guardian'
     or public.ops_engineer_for_alert('heartbeat_silent_crawl', null) <> 'scraping-engineer'
     or public.ops_engineer_for_alert('heartbeat_silent_facts', null) <> 'advanced_filter'
     or public.ops_engineer_for_alert('heartbeat_silent_lifecycle', null) <> 'lifecycle'
     or public.ops_engineer_for_alert('heartbeat_silent', null) <> 'repair'
     or public.ops_engineer_for_alert('bedrooms_not_captured_fleet', null) <> 'scraping-engineer' then
    raise exception 'PROOF: heartbeat lanes are not routed as written';
  end if;
  begin
    insert into public.ops_heartbeat_expectations (stream, relation, ts_expr, filter_sql, window_hours, min_rows, alert_kind, measured)
    values ('__selftest_clicks__', 'clicks', 'created_at', 'false', 72, 1, 'heartbeat_silent_clicks', 'selftest');
    insert into public.ops_heartbeat_expectations (stream, covered_by, measured)
    values ('__selftest_cover__', 'mon_detect_no_such_detector_selftest', 'selftest');
    perform public.mon_detect_heartbeat_silent();
    select detail into d from public.alert_event where dedup_key = 'heartbeat_silent:__selftest_clicks__' and resolved_at is null and kind = 'heartbeat_silent_clicks' and severity = 'P1';
    if d is null or d->>'stream' <> '__selftest_clicks__' or not (d ? 'last_row_at') then
      raise exception 'PROOF: a silent stream did not raise a P1 naming it and its last row time: %', d;
    end if;
    if not exists (select 1 from public.alert_event where dedup_key = 'heartbeat_cover_missing:__selftest_cover__' and resolved_at is null) then
      raise exception 'PROOF: a cover pointing at a detector nothing runs was not raised';
    end if;
    update public.ops_heartbeat_expectations set filter_sql = null where stream = '__selftest_clicks__';
    perform public.mon_detect_heartbeat_silent();
    if exists (select 1 from public.alert_event where dedup_key = 'heartbeat_silent:__selftest_clicks__' and resolved_at is null) then
      raise exception 'PROOF: the stream moved again but the P1 stayed open';
    end if;
    raise exception '__heartbeat_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__heartbeat_selftest_rollback__' then raise; end if;
  end;
  if exists (select 1 from public.ops_heartbeat_expectations where stream like '\_\_selftest%') then
    raise exception 'PROOF: the selftest rows were not rolled back';
  end if;
  if position('mon_detect_heartbeat_silent' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector is not on the roster';
  end if;
  perform public.mon_detect_heartbeat_silent();
  select string_agg(dedup_key || ' last ' || coalesce(detail->>'last_row_at', 'never'), '; ') into v_silent
    from public.alert_event where resolved_at is null and (kind like 'heartbeat\_silent%' or kind = 'heartbeat_cover_missing');
  raise notice 'PROOF: silent stream raises P1 + resolves on movement, lost cover raises P2, lanes routed, on the roster. Silent now: %', coalesce(v_silent, 'none');
end $$;
