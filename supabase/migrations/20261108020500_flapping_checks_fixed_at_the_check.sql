-- 🔧 2026-11-08 — four of the top-8 repeat kinds were CHECKS that flap, not bugs that recur (measured 7 days to 11-08).
-- Each is fixed in the check, by exact-text replace of the LIVE definition, without hiding a real failure:
--  A. run_duration_explosion (33 reopens): an IN-FLIGHT run has rows_seen = 0 until end_run(), so its throughput read 0
--     by construction and every long daily job (fleet_liveness:haraj ~300 min, wasalt_enum_shard ~180 min) «stalled»
--     every day, opening at start and closing at finish. An in-flight run now counts only once it is past 1.5× the
--     platform's longest healthy finished run (p95 of ok runs with rows) — a true hang still raises; a finished run is
--     judged exactly as before.
--  B. liveness_job_silent (17 reopens): cadence was the 45-day median batch gap, but the :recheck runs moved to their own
--     label, so the base label (now daily) kept a ~7 h cadence and read «silent» every morning (~21 h). Cadence is now
--     the median of the LAST 5 batch gaps — the job's current pace; factor 3 and the 6 h floor are unchanged.
--  C. source_district_dropped (16 reopens): the :59 sweep reads the index after the :54 recovery but before the :22 sync
--     carries it, so one-sweep drops healed on their own. It now raises only when the drop held across two consecutive
--     sweeps (mon_condition_held, ≥ 50 min); once open it re-affirms and resolves exactly as before.
--  D. alert_delivery (20 reopens): GitHub fired alert-dispatch.yml's own 9,39 schedule ~5 times a day, so the hourly :43
--     bundle was the only real dispatch and a :59 sweep's alerts waited ~45-60 min against a 60 min grace. The :59 job's
--     mon_dispatch_alerts() now also triggers alert-dispatch.yml when deliverable alerts are waiting (pg_net sends after
--     commit). The 60 min grace is NOT loosened.

-- C. the debounce primitive: true once p_bad has held continuously for p_for; a clean reading clears it.
create table if not exists public.ops_check_pending (
  check_key text primary key,
  first_bad_at timestamptz not null default now()
);
alter table public.ops_check_pending enable row level security;
revoke all on public.ops_check_pending from public, anon, authenticated;
comment on table public.ops_check_pending is
  'Debounce state for mon_condition_held(): when a check first read bad, cleared by the first clean reading. A check that flaps across one pipeline tick raises only if the bad state survives the next sweep.';

create or replace function public.mon_condition_held(p_key text, p_bad boolean, p_for interval)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_first timestamptz;
begin
  if not coalesce(p_bad, false) then
    delete from public.ops_check_pending where check_key = p_key;
    return false;
  end if;
  insert into public.ops_check_pending (check_key) values (p_key)
  on conflict (check_key) do update set check_key = excluded.check_key
  returning first_bad_at into v_first;
  return v_first <= now() - p_for;
end $function$;
revoke all on function public.mon_condition_held(text, boolean, interval) from public, anon, authenticated;
grant execute on function public.mon_condition_held(text, boolean, interval) to service_role;

do $$
declare src text; out_def text;
begin
  -- A. run_duration_explosion
  src := pg_get_functiondef('public.mon_detect_run_duration_explosion()'::regprocedure);
  if position('p95_ok_min' in src) = 0 then
    out_def := replace(src,
      E'             count(*) runs\n',
      E'             (percentile_cont(0.95) within group (\n'
      || E'               order by extract(epoch from (finished_at - started_at))/60.0)\n'
      || E'               filter (where ok and rows_seen > 0))::numeric p95_ok_min,\n'
      || E'             count(*) runs\n');
    out_def := replace(out_def,
      E'       where s.started_at >= now() - interval ''24 hours''\n         and public.mon_run_duration_is_stall(',
      E'       where s.started_at >= now() - interval ''24 hours''\n'
      || E'         -- 2026-11-08: an in-flight run has rows_seen = 0 until end_run(); judge it only past 1.5x the longest healthy run.\n'
      || E'         and (s.finished_at is not null\n'
      || E'              or extract(epoch from (now() - s.started_at))/60.0 > 1.5 * coalesce(b.p95_ok_min, 0))\n'
      || E'         and public.mon_run_duration_is_stall(');
    if out_def = src or position('p95_ok_min' in out_def) = 0 or position('1.5 * coalesce(b.p95_ok_min' in out_def) = 0 then
      raise exception 'run_duration_explosion anchors not found — refusing to guess';
    end if;
    execute out_def;
  end if;

  -- B. liveness_job_silent
  src := pg_get_functiondef('public.mon_detect_liveness_job_silent()'::regprocedure);
  if position('recent_gaps' in src) = 0 then
    out_def := replace(src,
      E'    ), cadence as (\n',
      E'    ), recent_gaps as (\n'
      || E'      -- 2026-11-08: the job''s CURRENT pace = its last 5 batch gaps (a 45-day median kept a cadence the job left).\n'
      || E'      select platform, gap_s, row_number() over (partition by platform order by started_at desc) rn\n'
      || E'        from labelled where gap_s >= batch_gap_s\n'
      || E'    ), cadence as (\n');
    out_def := replace(out_def,
      E'             (percentile_cont(0.5) within group (order by gap_s)\n                filter (where gap_s >= batch_gap_s))::numeric median_gap_s,',
      E'             (select percentile_cont(0.5) within group (order by rg.gap_s)\n'
      || E'                from recent_gaps rg where rg.platform = labelled.platform and rg.rn <= 5)::numeric median_gap_s,');
    if position('rg.rn <= 5' in out_def) = 0 or position('recent_gaps as' in out_def) = 0 then
      raise exception 'liveness_job_silent anchors not found — refusing to guess';
    end if;
    execute out_def;
  end if;

  -- C. source_district_dropped
  src := pg_get_functiondef('public.mon_detect_source_district_dropped()'::regprocedure);
  if position('mon_condition_held' in src) = 0 then
    out_def := replace(src, 'declare v_dropped bigint;', 'declare v_held boolean; v_dropped bigint;');
    out_def := replace(out_def,
      E'  if v_dropped = 0 then\n',
      E'  v_held := public.mon_condition_held(''source_district_dropped'', v_dropped > 0, interval ''50 minutes'');\n'
      || E'  if v_dropped = 0 then\n');
    out_def := replace(out_def,
      E'  else  -- re-affirm every sweep',
      E'  elsif v_open is null and not v_held then\n'
      || E'    null;  -- 2026-11-08: one sweep between the :54 recovery and the :22 sync is not a drop; the next sweep decides\n'
      || E'  else  -- re-affirm every sweep');
    if position('v_held boolean' in out_def) = 0 or position('v_held := public.mon_condition_held' in out_def) = 0
       or position('elsif v_open is null and not v_held' in out_def) = 0 then
      raise exception 'source_district_dropped anchors not found — refusing to guess';
    end if;
    execute out_def;
  end if;

  -- D. alert dispatch right after the sweep that raised
  src := pg_get_functiondef('public.mon_dispatch_alerts()'::regprocedure);
  if position('trigger_gh_workflow(''alert-dispatch.yml'')' in src) = 0 then
    out_def := replace(src,
      E'  begin\n    if deadman is not null then perform net.http_get(url := deadman); end if;',
      E'  -- 2026-11-08: dispatch now, not at the next :43 (GitHub''s own schedule for alert-dispatch.yml rarely fires).\n'
      || E'  if exists (select 1 from public.alert_event where resolved_at is null and dispatched_at is null\n'
      || E'               and severity in (''P0'', ''P1'', ''P2'')) then\n'
      || E'    begin\n'
      || E'      perform public.trigger_gh_workflow(''alert-dispatch.yml'');\n'
      || E'    exception when others then\n'
      || E'      raise notice ''mon_dispatch_alerts: alert-dispatch trigger failed (%), the :43 bundle still dispatches'', sqlerrm;\n'
      || E'    end;\n'
      || E'  end if;\n\n'
      || E'  begin\n    if deadman is not null then perform net.http_get(url := deadman); end if;');
    if out_def = src then raise exception 'mon_dispatch_alerts anchor not found — refusing to guess'; end if;
    execute out_def;
  end if;
end $$;

-- MUTATION PROOF (rolled back): each fixed check still raises the REAL failure and no longer raises the flap.
do $$
begin
  begin
    -- A. platform with healthy runs of ~100 min (p95 ~100) and a 4-min median: an in-flight run at 120 min is not
    --    judged; one at 200 min (> 1.5 × p95) is; a FINISHED 0-row 200-min run still is.
    insert into public.scrape_runs (platform, started_at, finished_at, ok, rows_seen)
    select '__selftest_rde__', now() - make_interval(days => 2 + g) , now() - make_interval(days => 2 + g) + case when g % 4 = 0 then interval '100 minutes' else interval '4 minutes' end, true,
           case when g % 4 = 0 then 5000 else 200 end
      from generate_series(1, 12) g;
    insert into public.scrape_runs (platform, started_at, ok, rows_seen) values ('__selftest_rde__', now() - interval '120 minutes', null, 0);
    perform public.mon_detect_run_duration_explosion();
    if exists (select 1 from public.alert_event where dedup_key = 'run_duration_explosion:__selftest_rde__' and resolved_at is null) then
      raise exception 'PROOF A: an in-flight run inside its normal long-run time still raised';
    end if;
    update public.scrape_runs set started_at = now() - interval '200 minutes' where platform = '__selftest_rde__' and finished_at is null;
    perform public.mon_detect_run_duration_explosion();
    if not exists (select 1 from public.alert_event where dedup_key = 'run_duration_explosion:__selftest_rde__' and resolved_at is null) then
      raise exception 'PROOF A: an in-flight run past 1.5x its longest healthy run did not raise (a real hang went blind)';
    end if;

    -- B. a job that used to run every 7 h and now runs daily: 25 h silent is NOT silent; 80 h silent IS.
    insert into public.scrape_runs (platform, started_at, finished_at, ok, rows_seen)
    select '__selftest_liveness__', t, t + interval '1 minute', true, 10
      from (select now() - interval '25 hours' - make_interval(days => d) as t from generate_series(0, 5) d
            union all select now() - interval '7 days' - make_interval(hours => 7 * h) from generate_series(1, 20) h) x;
    perform public.mon_detect_liveness_job_silent();
    if exists (select 1 from public.alert_event where dedup_key = 'liveness_job_silent:__selftest_liveness__' and resolved_at is null) then
      raise exception 'PROOF B: a daily job one day after its last run read as silent (old 7 h cadence still used)';
    end if;
    update public.scrape_runs set started_at = started_at - interval '55 hours', finished_at = finished_at - interval '55 hours'
     where platform = '__selftest_liveness__' and started_at > now() - interval '30 hours';
    delete from public.scrape_runs where platform = '__selftest_liveness__' and started_at between now() - interval '80 hours' and now() - interval '30 hours';
    perform public.mon_detect_liveness_job_silent();
    if not exists (select 1 from public.alert_event where dedup_key = 'liveness_job_silent:__selftest_liveness__' and resolved_at is null) then
      raise exception 'PROOF B: a daily job silent for 80 h did not raise';
    end if;

    -- C. the debounce: first bad reading false, still bad 50 min later true, a clean reading resets.
    if public.mon_condition_held('__selftest_held__', true, interval '50 minutes') then raise exception 'PROOF C: first bad reading already held'; end if;
    update public.ops_check_pending set first_bad_at = now() - interval '61 minutes' where check_key = '__selftest_held__';
    if not public.mon_condition_held('__selftest_held__', true, interval '50 minutes') then raise exception 'PROOF C: a held bad state did not report held'; end if;
    if public.mon_condition_held('__selftest_held__', false, interval '50 minutes')
       or public.mon_condition_held('__selftest_held__', true, interval '50 minutes') then
      raise exception 'PROOF C: a clean reading did not reset the debounce';
    end if;
    if position('mon_condition_held' in pg_get_functiondef('public.mon_detect_source_district_dropped()'::regprocedure)) = 0
       or position('trigger_gh_workflow(''alert-dispatch.yml'')' in pg_get_functiondef('public.mon_dispatch_alerts()'::regprocedure)) = 0 then
      raise exception 'PROOF C/D: a patched definition did not land';
    end if;
    raise exception '__flap_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__flap_selftest_rollback__' then raise; end if;
  end;
  if exists (select 1 from public.scrape_runs where platform like '\_\_selftest%')
     or exists (select 1 from public.ops_check_pending where check_key like '\_\_selftest%') then
    raise exception 'PROOF: selftest rows were not rolled back';
  end if;
  raise notice 'PROOF: A in-flight judged only past 1.5x p95, B current cadence, C debounce holds+resets, D dispatch trigger; rolled back';
end $$;
