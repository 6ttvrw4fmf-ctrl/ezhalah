-- ─────────────────────────────────────────────────────────────────────────────────────────
-- BATCH 0 — DETECTION & ALERTING SPINE (hardening RC-E). ADDITIVE + ALERT-ONLY. Zero behavior
-- change to any existing scraper/search/UI path: only NEW tables, functions, and a view. Nothing
-- here is scheduled by this file — see the "ACTIVATION (owner-gated)" block at the very bottom; it
-- stays commented until the owner approves turning the crons on, so applying this migration is inert
-- until then. Detectors read tables that ALREADY hold the truth (scrape_runs, crawl_stats_*,
-- cron.job_run_details, the per-platform *_listings tables), so the spine lights up the currently-
-- invisible failures (16 dark platforms, aqar 38.8% stale-active, frozen jobid 22, alnokhba's
-- ok=true/seen=0 silent death) the instant it runs — with no risk to production data.
--
-- WHY: the 2026-07-13 hardening audit found the force-multiplier is "blind & mute monitoring":
-- freshness keys on last_seen (which lies), monitors INSERT rows nobody reads, cron-health watches
-- 3 of ~30 jobs, and there is no human-channel alerting anywhere. This spine is the one place every
-- future detector plugs into, and the one dispatcher that can page a human + a dead-man's-switch.
--
-- NEUTRALITY: alert-only. Never modifies a listing, never classifies, never hides a source.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- ── config (webhook URL / dead-man URL / thresholds; secret values set post-deploy, not in git) ──
create table if not exists public.mon_config (
  key   text primary key,
  value text,
  note  text
);
insert into public.mon_config(key, value, note) values
  ('alert_webhook_url', null, 'HTTPS endpoint the dispatcher POSTs unacked alerts to (Slack/Teams/email-relay/WhatsApp-relay). Owner sets via update; kept out of git.'),
  ('deadman_ping_url',  null, 'External dead-man''s-switch (e.g. healthchecks.io) the dispatcher GETs each run so a dead pg_cron is itself detectable.'),
  ('stale_active_warn_frac', '0.15', 'stale-active-fraction warning threshold'),
  ('stale_active_crit_frac', '0.30', 'stale-active-fraction critical threshold'),
  ('volume_drop_frac',       '0.20', 'active_now drop vs 7d median that fires a collapse alert')
on conflict (key) do nothing;

-- ── platform registry: single source of truth for status + expected cadence. Retired platforms
--    auto-drop from every detector (kills the toor/muktamel false-critical spam). ─────────────────
create table if not exists public.platform_registry (
  platform              text primary key,
  status                text not null default 'active' check (status in ('active','dormant','retired')),
  expected_cadence_hours integer not null default 24,
  window_days           integer not null default 7,
  notes                 text,
  updated_at            timestamptz not null default now()
);
-- seed: statuses reflect the 2026-07-12/13 audits. min-new is intentionally NOT a hardcoded number —
-- the zero-new-stall detector self-calibrates (alerts only when a platform that produced last window
-- suddenly produces nothing), so a genuinely-static boutique never false-alarms.
insert into public.platform_registry(platform, status, expected_cadence_hours, notes) values
  ('aqar','active',8,'core'), ('wasalt','active',8,'core; enum-liveness jobid36'), ('gathern','active',24,'short-term rentals, high churn'),
  ('dealapp','active',24,null), ('aqarcity','active',24,'sitemap+id-walk (jobid discovery fixed 2026-07-11)'),
  ('aqarmonthly','active',24,null), ('sanadak','active',24,null), ('mustqr','active',24,null),
  ('eaqartabuk','active',24,null), ('raghdan','active',24,null), ('aqargate','active',24,null),
  ('alkhaas','active',24,null), ('eastabha','active',24,null), ('aldarim','active',24,null),
  ('aqaratikom','active',24,'nawait.sa IP-blocks GH runners — needs proxy'), ('ramzalqasim','active',24,null),
  ('abeea','active',24,null), ('jazwtn','active',24,null), ('hajer','active',24,null),
  ('satel','active',24,null), ('sadin','active',24,null), ('awal','active',24,null),
  ('souq24','active',24,null), ('erapulse','active',24,null), ('mizlaj','active',24,null),
  ('alhoshan','active',24,null), ('nowaisiry','active',24,null), ('fursaghyr','active',24,null),
  ('jurash','active',24,null), ('october','active',24,null), ('alnokhba','active',24,'audit: ok=true/seen=0 x5 — investigate'),
  ('deal','retired',9999,'deprecated 2026-06-26, excluded from search'),
  ('toor','retired',9999,'retired 2026-07-06, host IP-blocks'),
  ('muktamel','retired',9999,'dormant, weekly job cancels; 0 rows ever')
on conflict (platform) do update set status=excluded.status, notes=coalesce(excluded.notes, public.platform_registry.notes), updated_at=now();

-- ── alert_event: the ONE alert sink. Debounced by dedup_key (one open row per issue). Has ack +
--    resolve so a human can close it, and dispatched_at so the dispatcher sends each once. ─────────
create table if not exists public.alert_event (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  severity       text not null check (severity in ('P0','P1','P2','P3')),
  kind           text not null,          -- 'silent_scraper_death' | 'zero_new_stall' | 'stale_active' | 'volume_drop' | 'cron_health'
  platform       text,
  dedup_key      text not null,          -- one OPEN row per (kind,platform,subject)
  detail         jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz,
  resolved_at    timestamptz,
  dispatched_at  timestamptz
);
create index if not exists alert_event_open_idx on public.alert_event(dedup_key) where resolved_at is null;
create index if not exists alert_event_undispatched_idx on public.alert_event(created_at) where dispatched_at is null and resolved_at is null;

-- helper: raise an alert unless an identical OPEN one already exists (debounce). Returns 1 if new.
create or replace function public.mon_raise(p_sev text, p_kind text, p_platform text, p_dedup text, p_detail jsonb)
 returns integer language plpgsql security definer set search_path to 'public' as $$
begin
  if exists (select 1 from public.alert_event where dedup_key = p_dedup and resolved_at is null) then
    return 0;
  end if;
  insert into public.alert_event(severity, kind, platform, dedup_key, detail)
  values (p_sev, p_kind, p_platform, p_dedup, coalesce(p_detail,'{}'::jsonb));
  return 1;
end $$;

-- helper: auto-resolve open alerts of a kind for a platform when the condition clears (self-healing).
create or replace function public.mon_resolve(p_kind text, p_platform text)
 returns void language sql security definer set search_path to 'public' as $$
  update public.alert_event set resolved_at = now()
  where kind = p_kind and platform is not distinct from p_platform and resolved_at is null;
$$;

-- ── heartbeat table (populated by scrapers in Batch 2; created now so detectors/dashboard can read
--    it once wired). Batch 0 detectors work off scrape_runs today, so this is forward-compatible. ──
create table if not exists public.scraper_run_heartbeat (
  id             bigint generated always as identity primary key,
  run_id         bigint,
  platform       text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  rows_seen      integer,
  rows_new       integer,
  blocked        boolean not null default false,
  http_error_rate numeric,
  exit_status    text,
  notes          text
);
create index if not exists heartbeat_platform_time_idx on public.scraper_run_heartbeat(platform, started_at desc);

-- ═══════════════════════ DETECTORS (read-only over existing truth; emit debounced alerts) ═══════

-- D1 · silent scraper death: an ACTIVE registry platform whose last 3 real runs are all
-- ok=false OR (ok=true AND rows_seen=0). Excludes the ':'-namespaced liveness/cleanup pseudo-runs.
create or replace function public.mon_detect_silent_scraper_death()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare rec record; n int := 0;
begin
  for rec in
    with runs as (
      select platform, ok, coalesce(rows_seen,0) rows_seen, started_at,
             row_number() over (partition by platform order by started_at desc) rn
      from public.scrape_runs
      where started_at > now() - interval '6 days' and platform !~ ':'
    ), last3 as (
      select r.platform, count(*) n_runs,
             count(*) filter (where r.ok and r.rows_seen>0) n_healthy,
             max(r.started_at) last_run
      from runs r join public.platform_registry pr on pr.platform=r.platform and pr.status='active'
      where r.rn <= 3
      group by r.platform
    )
    select platform, n_runs, last_run from last3
    where n_runs >= 2 and n_healthy = 0     -- every recent run empty/failed
  loop
    n := n + public.mon_raise('P0','silent_scraper_death', rec.platform,
      'silent_scraper_death:'||rec.platform,
      jsonb_build_object('recent_runs', rec.n_runs, 'last_run', rec.last_run,
        'why','last '||rec.n_runs||' runs all ok=false or 0-row (fail-blind finalize)'));
  end loop;
  -- self-heal: platforms with a healthy recent run
  update public.alert_event a set resolved_at=now()
  where a.kind='silent_scraper_death' and a.resolved_at is null
    and exists (select 1 from public.scrape_runs s where s.platform=a.platform and s.ok and coalesce(s.rows_seen,0)>0 and s.started_at>now()-interval '2 days');
  return n;
end $$;

-- D2 · zero-new stall (fixes last_seen blindness): a platform that produced NEW listings in the
-- prior window but ZERO in the recent window → the scraper runs but discovers nothing (aqarcity's
-- 15-day silent stall). Self-calibrating, so static boutiques never false-alarm.
create or replace function public.mon_detect_zero_new_stall()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare rec record; n int := 0;
begin
  for rec in
    select d.platform,
           sum(d.new_listings) filter (where d.day >  current_date - 4) new_recent,
           sum(d.new_listings) filter (where d.day between current_date - 18 and current_date - 4) new_prior
    from public.crawl_stats_platform_daily d
    join public.platform_registry pr on pr.platform=d.platform and pr.status='active'
    group by d.platform
  loop
    if coalesce(rec.new_prior,0) >= 10 and coalesce(rec.new_recent,0) = 0 then
      n := n + public.mon_raise('P1','zero_new_stall', rec.platform,
        'zero_new_stall:'||rec.platform,
        jsonb_build_object('new_prior_14d', rec.new_prior, 'new_recent_4d', 0,
          'why','produced new listings before but 0 in the last 4 days — discovery stalled'));
    elsif coalesce(rec.new_recent,0) > 0 then
      perform public.mon_resolve('zero_new_stall', rec.platform);
    end if;
  end loop;
  return n;
end $$;

-- D3 · stale-active fraction (the "wasalt problem" tripwire, generalized): per platform's *_listings
-- tables, fraction of ACTIVE rows not re-seen in >7d. warn ≥ config, critical ≥ config. Would have
-- flagged aqar (38.8%) and dealapp weeks ago.
create or replace function public.mon_detect_stale_active_fraction()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare rec record; n int := 0; warn numeric; crit numeric; frac numeric; active_n bigint; stale_n bigint;
begin
  select value::numeric into warn from public.mon_config where key='stale_active_warn_frac';
  select value::numeric into crit from public.mon_config where key='stale_active_crit_frac';
  for rec in
    select pr.platform, t.table_name tn
    from public.platform_registry pr
    join information_schema.tables t
      on t.table_schema='public' and t.table_name like pr.platform||'\_%\_listings'
    where pr.status='active'
      and exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t.table_name and c.column_name='last_seen_at')
  loop
    begin
      execute format('select count(*) filter (where active), count(*) filter (where active and last_seen_at < now()-interval ''7 days'') from public.%I', rec.tn)
        into active_n, stale_n;
    exception when others then continue; end;
    if coalesce(active_n,0) < 20 then continue; end if;   -- tiny tables handled by D1/coverage, not fraction
    frac := stale_n::numeric / active_n;
    if frac >= crit then
      n := n + public.mon_raise('P1','stale_active', rec.platform, 'stale_active:'||rec.tn,
        jsonb_build_object('table',rec.tn,'active',active_n,'stale_7d',stale_n,'frac',round(frac,3),'level','critical'));
    elsif frac >= warn then
      n := n + public.mon_raise('P2','stale_active', rec.platform, 'stale_active:'||rec.tn,
        jsonb_build_object('table',rec.tn,'active',active_n,'stale_7d',stale_n,'frac',round(frac,3),'level','warning'));
    else
      perform public.mon_resolve('stale_active', rec.platform);
    end if;
  end loop;
  return n;
end $$;

-- D4 · volume-drop / collapse: a platform's active_now drops > config fraction vs its 7-day median
-- (false-kill, ingest wipe, or dedup bug). Reads crawl_stats_platform_daily.
create or replace function public.mon_detect_volume_drop()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare rec record; n int := 0; drop_frac numeric;
begin
  select value::numeric into drop_frac from public.mon_config where key='volume_drop_frac';
  for rec in
    -- percentile_cont is an ordered-set aggregate (WITHIN GROUP) and cannot take an OVER() window,
    -- so compute the 7-day median and "today" as plain grouped aggregates over each platform.
    select platform,
           (array_agg(active_now order by day desc))[1] today,
           percentile_cont(0.5) within group (order by active_now) med
    from public.crawl_stats_platform_daily
    where day > current_date - 8
    group by platform
  loop
    -- Floor at 500: volume-drop targets a MAJOR-platform collapse (ingest wipe / dedup bug / false
    -- mass-kill). Small high-churn platforms (awal/satel/ramzalqasim routinely shed 40-60% via
    -- legitimate sold-pin cleanup) would otherwise fire P1 constantly → alert fatigue; they're
    -- already covered by silent_scraper_death + stale_active + zero_new_stall.
    if rec.med >= 500 and rec.today < (1.0 - drop_frac) * rec.med then
      n := n + public.mon_raise('P1','volume_drop', rec.platform, 'volume_drop:'||rec.platform,
        jsonb_build_object('active_today', rec.today, 'median_7d', round(rec.med), 'drop_pct', round(100*(1 - rec.today/rec.med))));
    else
      perform public.mon_resolve('volume_drop', rec.platform);
    end if;
  end loop;
  return n;
end $$;

-- D5 · generic cron health: EVERY active cron.job (not a hardcoded 3). Alerts if the last run failed
-- or if no successful run within 2× the job's expected cadence (parsed loosely from the schedule).
create or replace function public.mon_detect_cron_health()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare rec record; n int := 0; last_ok timestamptz; last_status text; overdue_h int;
begin
  for rec in select jobid, jobname, schedule from cron.job where active loop
    select status, start_time into last_status, last_ok
      from cron.job_run_details where jobid=rec.jobid order by start_time desc limit 1;
    -- crude cadence: */N or 'N * * *' hourly-ish → ~1h; daily → ~24h; weekly → ~168h; default 24h
    overdue_h := case
      when rec.schedule ~ '^\*/[0-9]+ ' then 1
      when rec.schedule ~ '^[0-9]+ \* ' then 2
      when rec.schedule ~ '\* \* [0-6]$' then 168*2
      else 24*2 end;
    select start_time into last_ok from cron.job_run_details where jobid=rec.jobid and status='succeeded' order by start_time desc limit 1;
    if last_status = 'failed' then
      n := n + public.mon_raise('P1','cron_health', null, 'cron_fail:'||rec.jobid,
        jsonb_build_object('jobid',rec.jobid,'job',rec.jobname,'last_status','failed'));
    elsif last_ok is not null and last_ok < now() - make_interval(hours => overdue_h) then
      -- ran successfully before but has since gone stale (the "a cron silently stopped" signal).
      -- A brand-new job that has never run (last_ok IS NULL, no failed run) is intentionally NOT
      -- alerted — it isn't overdue, it just hasn't been due yet (else every freshly-created job
      -- false-alarms until its first fire).
      n := n + public.mon_raise('P2','cron_health', null, 'cron_overdue:'||rec.jobid,
        jsonb_build_object('jobid',rec.jobid,'job',rec.jobname,'last_success',last_ok,'overdue_h',overdue_h));
    else
      update public.alert_event set resolved_at=now()
      where kind='cron_health' and resolved_at is null and dedup_key in ('cron_fail:'||rec.jobid,'cron_overdue:'||rec.jobid);
    end if;
  end loop;
  return n;
end $$;

-- ── orchestrator: run all detectors, return per-kind new-alert counts ──
create or replace function public.mon_run_all_detectors()
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a int; b int; c int; d int; e int;
begin
  a := public.mon_detect_silent_scraper_death();
  b := public.mon_detect_zero_new_stall();
  c := public.mon_detect_stale_active_fraction();
  d := public.mon_detect_volume_drop();
  e := public.mon_detect_cron_health();
  return jsonb_build_object('silent_scraper_death',a,'zero_new_stall',b,'stale_active',c,'volume_drop',d,'cron_health',e,'ran_at',now());
end $$;

-- ── dispatcher: push undispatched OPEN alerts to the human channel + ping the dead-man's-switch.
--    No-ops safely if no webhook is configured (so applying + running before the owner sets the
--    secret is harmless). ──
create or replace function public.mon_dispatch_alerts()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare hook text; deadman text; payload jsonb; n int := 0;
begin
  select value into hook    from public.mon_config where key='alert_webhook_url';
  select value into deadman from public.mon_config where key='deadman_ping_url';
  if hook is not null then
    select jsonb_build_object(
             'source','ezhalah-monitoring','sent_at',now(),
             'open_alerts', (select count(*) from public.alert_event where resolved_at is null),
             'new', coalesce(jsonb_agg(jsonb_build_object('sev',severity,'kind',kind,'platform',platform,'detail',detail)),'[]'::jsonb))
      into payload
      from public.alert_event where dispatched_at is null and resolved_at is null;
    if (payload->>'new') <> '[]' then
      perform net.http_post(url := hook, headers := '{"Content-Type":"application/json"}'::jsonb, body := payload);
      update public.alert_event set dispatched_at=now() where dispatched_at is null and resolved_at is null;
      get diagnostics n = row_count;
    end if;
  end if;
  if deadman is not null then perform net.http_get(url := deadman); end if;  -- "I'm alive" heartbeat
  return n;
end $$;

-- ── dashboard: one view for humans / an admin screen ──
create or replace view public.monitoring_dashboard as
  select severity, kind, platform, detail, created_at,
         acknowledged_at is not null as acknowledged,
         extract(epoch from (now()-created_at))/3600 as age_hours
  from public.alert_event
  where resolved_at is null
  order by array_position(array['P0','P1','P2','P3'], severity), created_at;

-- ═══════════════════════ ACTIVATION (owner-gated — commented; run on approval) ═══════════════════
-- select cron.schedule('mon-run-detectors', '20 * * * *', $$select public.mon_run_all_detectors()$$);
-- select cron.schedule('mon-dispatch',      '25 * * * *', $$select public.mon_dispatch_alerts()$$);
-- update public.mon_config set value='<SLACK/EMAIL/WHATSAPP WEBHOOK>' where key='alert_webhook_url';
-- update public.mon_config set value='<https://hc-ping.com/...>'      where key='deadman_ping_url';
-- ─────────────────────────────────────────────────────────────────────────────────────────
