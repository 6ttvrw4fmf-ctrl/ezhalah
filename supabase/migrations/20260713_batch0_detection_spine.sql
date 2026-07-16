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
  ('jurash','active',24,null), ('october','active',24,null),
  ('alnokhba','retired',9999,'deprecated 2026-07-14, alnokhba-services.com domain lapsed to a parking page; removed from small-sources-sync.yml matrix'),
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


-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ADDITION to supabase/migrations/20260713_batch0_detection_spine.sql (branch
-- feat/batch0-detection-spine, draft PR #69 — append anywhere after alert_event + mon_raise are
-- defined, e.g. right after D5 / before the "orchestrator" section). ADDITIVE + ALERT-ONLY, same
-- as the rest of Batch 0: one new function, touches no existing table, changes no existing
-- behavior, is not wired into mon_run_all_detectors() (it is per-run, invoked from end_run via
-- Batch 2, not a scheduled sweep).
--
-- POST-RUN FIELD-RANGE CHECK (not part of the D1-D6 scheduled-sweep sequence; this is invoked
-- per-run from end_run(), not a scheduled sweep). Batch 2's end_run() chokepoint already demotes ok=True→
-- False on rows_seen==0 / floor / an explicit degraded=True from the caller (e.g. prune_unseen's
-- circuit breakers). This closes the remaining gap: a run can look completely healthy by those
-- measures while still having written rows with garbage prices, a placeholder location, or a
-- blank required field — "job finished successfully" is not the same claim as "the rows it wrote
-- are sane." Scoped to last_seen_at >= p_since on ONE named table — never a full-table scan.
--
-- WHY NOT reimplement placeholder-string detection here: scrapers/common/placeholder_tokens.py's
-- PLACEHOLDER_TOKENS is already THE canonical list (also used by db.py's own
-- guard_location_update / _reject_placeholder_location, which nulls these out BEFORE a row is
-- ever written). p_placeholder_tokens has NO default — the only correct call passes
-- `list(scrapers.common.placeholder_tokens.PLACEHOLDER_TOKENS)` from Python, so there is exactly
-- one copy of that list, ever. Finding a placeholder string here is not re-detecting the same
-- thing twice — it's evidence that guard was bypassed on some write path.
--
-- WHY NOT auto-resolve (unlike D1-D5): those are scheduled sweeps over a platform's FULL current
-- state, so mon_resolve(kind, platform) is safe there. This function only ever sees one run's
-- touched-row slice, and mon_resolve resolves by platform alone — calling it here for a platform
-- with both a residential AND commercial table could wrongly clear a still-open alert on the
-- OTHER table. So D6 only ever RAISES; resolving 'run_field_range' alerts is a human ack (or a
-- future dedicated reconciliation pass), not this function's job.
--
-- NEVER BLOCKS: pure read + one conditional insert via mon_raise; returns a boolean the caller
-- (end_run) folds into its EXISTING `degraded` demotion path. It cannot fail the write — the rows
-- are already committed by the time this runs.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.mon_check_run_field_ranges(
  p_run_id             bigint,          -- for the alert's detail payload only, not identity/dedup
  p_platform           text,
  p_table              text,           -- e.g. 'wasalt_residential_listings' — ONE named table/call
  p_since              timestamptz,    -- "touched this run" = last_seen_at >= p_since on p_table
  p_placeholder_tokens text[]          -- REQUIRED, no default: pass PLACEHOLDER_TOKENS from Python
) returns boolean                       -- true == this call's slice breached a threshold (degraded)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n                   bigint;
  buy_touched         bigint;
  rent_touched        bigint;
  buy_price_null      bigint;
  rent_price_null     bigint;
  absurd_price_active bigint;
  rent_active_n       bigint;
  rent_tiny           bigint;
  loc_placeholder     bigint;
  crit_null           bigint;
  degraded            boolean := false;
  worst_sev           text := 'P2';
  reasons             jsonb := '[]'::jsonb;
begin
  if p_table is null or p_since is null then
    return false;
  end if;

  -- Generic across the ~30 platform tables this could be pointed at: bail out quietly (never
  -- raise, never touch the caller's run) if the table doesn't have the columns this needs.
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = p_table
        and column_name in ('ad_number','listing_url','property_type','transaction_type',
                             'price_total','price_annual','city','region','active','last_seen_at')
     ) < 10
  then
    return false;
  end if;

  -- ONE aggregate pass over just this run's touched-row slice — cheap: bounded by what one
  -- run/shard actually wrote, not the table.
  execute format($f$
    select
      count(*),
      count(*) filter (where transaction_type = 'Buy'),
      count(*) filter (where transaction_type = 'Rent'),
      count(*) filter (where transaction_type = 'Buy'  and price_total  is null),
      count(*) filter (where transaction_type = 'Rent' and price_annual is null),
      count(*) filter (where active and (coalesce(price_total,0) > 100000000
                                       or coalesce(price_annual,0) > 100000000)),
      count(*) filter (where transaction_type = 'Rent' and active),
      count(*) filter (where transaction_type = 'Rent' and active and price_annual < 500),
      count(*) filter (where (city   is not null and lower(trim(city))   = any(%L::text[]))
                          or  (region is not null and lower(trim(region)) = any(%L::text[]))),
      count(*) filter (where trim(coalesce(ad_number,''))        = ''
                          or  trim(coalesce(listing_url,''))     = ''
                          or  trim(coalesce(property_type,''))   = ''
                          or  trim(coalesce(transaction_type,'')) = '')
    from public.%I
    where last_seen_at >= %L
  $f$, p_placeholder_tokens, p_placeholder_tokens, p_table, p_since)
  into n, buy_touched, rent_touched, buy_price_null, rent_price_null,
       absurd_price_active, rent_active_n, rent_tiny, loc_placeholder, crit_null;

  if coalesce(n, 0) = 0 then
    return false;   -- nothing touched in this window — nothing to say
  end if;

  -- (a) price sanity ------------------------------------------------------------------------
  if buy_price_null > 0 and (buy_price_null >= 5
        or (buy_touched > 0 and buy_price_null::numeric / buy_touched > 0.02)) then
    degraded := true;
    reasons := reasons || jsonb_build_object('check','buy_price_total_null',
                             'count',buy_price_null,'of',buy_touched);
  end if;
  if rent_price_null > 0 and (rent_price_null >= 5
        or (rent_touched > 0 and rent_price_null::numeric / rent_touched > 0.02)) then
    degraded := true;
    reasons := reasons || jsonb_build_object('check','rent_price_annual_null',
                             'count',rent_price_null,'of',rent_touched);
  end if;
  -- absurd active price: zero-tolerance — Batch 2's _sanitize_price() is supposed to have
  -- already flipped a row like this to active=false; one surviving as active means that guard
  -- didn't run or was bypassed on this write path.
  if absurd_price_active > 0 then
    degraded := true;
    worst_sev := 'P1';
    reasons := reasons || jsonb_build_object('check','absurd_price_while_active',
                             'count',absurd_price_active,'threshold_sar',100000000);
  end if;
  -- suspicious-tiny-rent pattern (guard against a NEW monthly-as-annual-shaped regression, not a
  -- re-detection of the already-fixed bug): >20% of this run's ACTIVE Rent rows have
  -- price_annual < 500 SAR — well below the ~3,000 line with known faithful placeholders below it.
  if rent_active_n >= 20 and rent_tiny::numeric / rent_active_n > 0.20 then
    degraded := true;
    reasons := reasons || jsonb_build_object('check','rent_annual_suspiciously_tiny',
                             'count',rent_tiny,'of_active_rent',rent_active_n,
                             'frac',round(rent_tiny::numeric/rent_active_n,3));
  end if;

  -- (b) location: zero-tolerance. guard_location_update/_reject_placeholder_location already
  -- NULL these before write; a placeholder string surviving to a read means that guard was
  -- bypassed on some path.
  if loc_placeholder > 0 then
    degraded := true;
    worst_sev := 'P1';
    reasons := reasons || jsonb_build_object('check','placeholder_location_written',
                             'count',loc_placeholder);
  end if;

  -- (c) critical required fields: zero-tolerance.
  if crit_null > 0 then
    degraded := true;
    worst_sev := 'P1';
    reasons := reasons || jsonb_build_object('check','missing_critical_field',
                             'count',crit_null,
                             'fields',array['ad_number','listing_url','property_type','transaction_type']);
  end if;

  if degraded then
    perform public.mon_raise(worst_sev, 'run_field_range', p_platform,
      'run_field_range:'||p_table,
      jsonb_build_object('table',p_table,'run_id',p_run_id,'since',p_since,
                          'touched',n,'reasons',reasons));
  end if;

  return degraded;
end $$;


-- ─────────────────────────────────────────────────────────────────────────────────────────
-- BATCH 0 ADDENDUM — D6: STALE-REFRESH DETECTOR (mv/index/tracking-table freshness).
-- Additive-only, follows the exact conventions of 20260713_batch0_detection_spine.sql
-- (config table -> detector function -> mon_raise/mon_resolve -> folded into
-- mon_run_all_detectors()). Depends on that migration already being applied (reuses
-- mon_raise/mon_resolve/alert_event/mon_run_all_detectors from feat/batch0-detection-spine,
-- PR #69 — NOT YET MERGED, so this addendum is likewise NOT YET APPLIED and should land in
-- the same PR/branch, applied after it).
--
-- WHY (2026-07-15 live health check): listing_location_canonical_mv + listing_location_index
-- were found ~7-9h stale; loc_rel_refresh_state (a DIFFERENT existing per-platform tracker)
-- had silently stalled 14 days on cron-connection contention (fixed today, jobid 22 now
-- ticks every 15 min). None of this was previously observable through Batch 0's 5 detectors
-- — they watch scraper *ingestion* health (scrape_runs / *_listings tables), not the
-- downstream search-index refresh layer that sits on top of ingestion. D6 closes that gap,
-- reusing the same spine.
--
-- INVESTIGATION FINDING THAT CHANGED THE DESIGN FROM THE ORIGINAL BRIEF:
-- The brief's "~2h per its own cron cadence" figure for listing_location_canonical_mv /
-- listing_location_index does not match live reality. Live cron.job shows jobid 16
-- ("refresh-location-index") is scheduled '0 2 * * *' — DAILY at 02:00 UTC, not every 2h —
-- and cron.job_run_details confirms 10/10 consecutive daily runs at exactly 02:00:00 UTC,
-- each succeeding in 20-33 seconds. So the ~7-9h staleness observed today (query run ~11:00-
-- 11:30 UTC, last refresh 02:00 UTC) is completely NORMAL mid-cycle staleness for a
-- once-a-day job, not an incident. Thresholds below are set against the REAL cadence (daily),
-- not the brief's assumed one, specifically so this detector does not fire a false P1/P2
-- every single day between 02:00 and the next morning. No `ops_expected_jobs` row documents a
-- 2h target either (that table doesn't exist — the 20260709_ops_monitoring_core.sql migration
-- was built+branch-tested but never applied, per project memory), so there is no competing
-- "documented intent" to reconcile against; the daily schedule IS the intent.
--
-- ORPHAN-OBJECT DECISION (investigated live, not assumed):
--   • location_index                     → EXCLUDED from monitoring.
--   • active_listing_ids (v1, no suffix) → EXCLUDED from monitoring.
-- Both are 17-22 days stale because NOTHING refreshes them anymore, confirmed three
-- independent ways: (1) live `cron.job` has zero jobs whose command mentions either bare name
-- — jobid 16 refreshes listing_location_index/listing_location_canonical_mv only, jobid 17
-- refreshes active_listing_ids_v2/listing_native_location_v1 only; (2) `pg_stat_user_tables`
-- shows their last_autoanalyze frozen at 2026-06-23 (location_index) / 2026-06-28
-- (active_listing_ids), exactly matching the "17-22 day" figure from today's health check —
-- i.e. that staleness is real, but it is because they were RETIRED, not because a live
-- refresh job broke; (3) `git grep` over origin/main finds zero live
-- `supabase.from('location_index')` / `active_listing_ids` (non-v2) call sites in src/ —
-- docs/ARCHITECTURE.md §13 confirms `location_index_live` (a view over
-- listing_location_canonical_mv) replaced location_index in the app on 2026-07-14, and there
-- is already a CI tripwire (scripts/verify-location-index-source.ts) that fails the build if
-- any file re-introduces a live query to the bare `location_index` table — i.e. regression
-- protection for "don't bring this back" already exists at the code layer.
-- `active_listing_ids_v2` documents itself in the same ARCHITECTURE.md row as the
-- "filter-before-cap" fix that superseded the v1 matview. Monitoring two objects nothing will
-- ever refresh again would be pure, permanent, un-actionable alert noise (exactly the "blind &
-- mute monitoring" antipattern Batch 0 exists to kill) — so they are deliberately left OUT of
-- mon_refresh_targets below. Recommended (NOT done here — a DDL drop is a separate, bigger
-- decision than an alerting addendum): drop both once the location_index_live repoint has
-- been live for a safety window, per ARCHITECTURE.md's own note ("location_index itself can
-- be dropped in a follow-up").
--
-- THE RIGHT WAY TO KNOW AN MV'S LAST REFRESH TIME (the brief's core question):
-- `pg_stat_user_tables.last_autovacuum` / `last_autoanalyze` do NOT work as a refresh clock:
-- autovacuum can independently re-analyze a matview based on row-churn heuristics with no
-- REFRESH having happened, so those two columns can drift "fresh" without a real refresh, or
-- sit stale despite a real one landing. There is no metadata column on a matview itself
-- recording "when was I last refreshed" — Postgres does not track that anywhere queryable.
-- What DOES work today, as an interim proxy: jobid 16 and jobid 17's cron commands run
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY x; ANALYZE x;` back-to-back in the same statement
-- batch, so `pg_stat_user_tables.last_analyze` (the EXPLICIT-analyze column — never touched by
-- autovacuum, only by a real `ANALYZE` statement) lands within ~1 second of the real refresh
-- completing. That is precise enough to use as of today, but it is a coincidence of how those
-- two cron commands happen to be written, not a guaranteed contract: nothing stops a future
-- edit to those commands from dropping the explicit ANALYZE, and if a REFRESH ever fails
-- mid-way through a chained SQL string, whether the trailing ANALYZE still fires depends on
-- pg_cron's statement-batch error handling, which is not something to rely on for a
-- freshness-of-record signal.
-- THE RIGHT LONG-TERM FIX: a dedicated, explicitly-stamped tracking table (mon_mv_refresh_log
-- below), written by the refresh jobs THEMSELVES on completion — the same pattern this repo
-- already uses for loc_rel_refresh_state (stamped by loc_rel_refresh_tick()) and
-- scraper_run_heartbeat (Batch 0/2). mon_mv_refresh_log is created now (additive, harmless,
-- starts empty) so the detector below can read it the moment it's wired; the precise follow-up
-- (NOT applied here — it edits two LIVE cron.job commands, which needs its own owner approval
-- per the standing PR-based-deploy-workflow / approval-workflow rules) is spelled out in the
-- "FOLLOW-UP (owner-gated)" block at the bottom. Until that follow-up lands, the detector
-- transparently falls back to the pg_stat_user_tables.last_analyze proxy and TAGS every alert
-- it raises with which source it actually used
-- (`"freshness_source":"pg_stat_last_analyze (interim proxy)"` vs
-- `"mon_mv_refresh_log (authoritative)"`), so nobody mistakes the interim signal for the real
-- one.
--
-- loc_rel_refresh_state is a DIFFERENT case and needs no proxy: it already has its own
-- `last_run_at` timestamptz column, stamped directly by loc_rel_refresh_tick() (jobid 22,
-- every 15 min) on every tick — that IS the authoritative signal already, we just weren't
-- alerting on it. It round-robins one source_table per tick (~64 rows / 15 min ≈ a ~16h full
-- sweep), so the correct check is NOT "is every individual row's last_run_at fresh" (most rows
-- are legitimately hours old between their turns) — it is "has the round-robin mechanism
-- ticked AT ALL recently", i.e. MAX(last_run_at) over the whole table within a few multiples
-- of the 15-min cadence. That framing is exactly what would have caught today's 14-day stall
-- the moment it happened, instead of 14 days later.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- ── config: one row per monitored object. `own_table`/`own_column` used only when
--    check_kind='own_timestamp_column' (identifiers, not user input — only ever set by this
--    migration / a future owner-reviewed migration, never by request-time code).
create table if not exists public.mon_refresh_targets (
  object_name              text primary key,
  check_kind               text not null check (check_kind in ('mv_freshness','own_timestamp_column')),
  own_table                text,             -- required when check_kind='own_timestamp_column'
  own_column               text,             -- required when check_kind='own_timestamp_column'
  warn_after_minutes       integer not null,
  crit_after_minutes       integer not null,
  active                   boolean not null default true,
  notes                    text,
  updated_at               timestamptz not null default now()
);

-- ── the authoritative stamp table for MV refreshes (the "right way"). Starts EMPTY — nothing
--    writes to it until the follow-up at the bottom updates jobid 16/17. Harmless to create
--    now: the detector below already knows to fall back to the pg_stat proxy while it's empty.
create table if not exists public.mon_mv_refresh_log (
  object_name   text primary key,
  refreshed_at  timestamptz not null,
  rows_after    bigint,
  note          text
);

alter table public.mon_refresh_targets enable row level security;   -- service-role only (mirrors
alter table public.mon_mv_refresh_log  enable row level security;   -- platform_subvertical_cadence's convention in PR #77)
revoke all on public.mon_refresh_targets from public, anon, authenticated;
revoke all on public.mon_mv_refresh_log  from public, anon, authenticated;
grant select, insert, update on public.mon_refresh_targets to service_role;
grant select, insert, update on public.mon_mv_refresh_log  to service_role;

-- Seed: the 5 objects confirmed live today to matter. location_index / active_listing_ids (v1)
-- deliberately NOT seeded here — see "ORPHAN-OBJECT DECISION" above.
insert into public.mon_refresh_targets
  (object_name, check_kind, own_table, own_column, warn_after_minutes, crit_after_minutes, notes)
values
  ('listing_location_canonical_mv', 'mv_freshness', null, null, 1800, 2880,
    'refreshed by jobid 16 (refresh-location-index), daily 02:00 UTC, confirmed 10/10 recent runs succeeded in <35s; warn=30h/crit=48h gives buffer over the 24h cadence without alarming mid-cycle'),
  ('listing_location_index',        'mv_freshness', null, null, 1800, 2880,
    'same job (jobid 16) as listing_location_canonical_mv, same thresholds'),
  ('active_listing_ids_v2',         'mv_freshness', null, null, 180, 360,
    'refreshed by jobid 17 (refresh_listing_native_location_v1), hourly; warn=3h/crit=6h'),
  ('listing_native_location_v1',    'mv_freshness', null, null, 180, 360,
    'same job (jobid 17) as active_listing_ids_v2, same thresholds'),
  ('loc_rel_refresh_state',         'own_timestamp_column', 'loc_rel_refresh_state', 'last_run_at', 45, 90,
    'dead-man''s-switch on jobid 22 (refresh-loc-rel-signals, */15 * * * *) via loc_rel_refresh_tick(); checks MAX(last_run_at) across the whole round-robin table, NOT per-row, since each tick only touches one source_table row and most rows are legitimately hours old between turns; this is the exact signal that would have caught the 2026-07-15 14-day stall the day it started')
on conflict (object_name) do update set
  check_kind=excluded.check_kind, own_table=excluded.own_table, own_column=excluded.own_column,
  warn_after_minutes=excluded.warn_after_minutes, crit_after_minutes=excluded.crit_after_minutes,
  notes=excluded.notes, updated_at=now();

-- ── D6 · stale refresh: per active mon_refresh_targets row, resolve "last refreshed at" per
-- check_kind, compare against warn/crit thresholds, raise/resolve through the SAME alert_event
-- sink as D1-D5 (kind='stale_refresh', platform column reused to carry object_name so the
-- existing monitoring_dashboard view groups/dedupes it for free, no schema change needed).
create or replace function public.mon_detect_stale_refresh()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  rec record;
  last_refresh timestamptz;
  freshness_source text;
  stale_min numeric;
begin
  for rec in select * from public.mon_refresh_targets where active loop
    last_refresh := null;
    freshness_source := null;

    if rec.check_kind = 'mv_freshness' then
      select refreshed_at into last_refresh
      from public.mon_mv_refresh_log where object_name = rec.object_name;
      if last_refresh is not null then
        freshness_source := 'mon_mv_refresh_log (authoritative)';
      else
        select last_analyze into last_refresh
        from pg_stat_user_tables
        where schemaname = 'public' and relname = rec.object_name;
        freshness_source := 'pg_stat_last_analyze (interim proxy — see migration header)';
      end if;

    elsif rec.check_kind = 'own_timestamp_column' then
      begin
        execute format('select max(%I) from public.%I', rec.own_column, rec.own_table) into last_refresh;
        freshness_source := format('%I.%I (authoritative, own column)', rec.own_table, rec.own_column);
      exception when others then
        last_refresh := null;
        freshness_source := 'error reading own_table/own_column — see notes';
      end;
    end if;

    stale_min := extract(epoch from (now() - coalesce(last_refresh, 'epoch'::timestamptz))) / 60.0;

    if stale_min >= rec.crit_after_minutes then
      perform public.mon_raise('P1', 'stale_refresh', rec.object_name, 'stale_refresh:'||rec.object_name,
        jsonb_build_object('object', rec.object_name, 'last_refresh', last_refresh,
          'stale_minutes', round(stale_min), 'crit_after_minutes', rec.crit_after_minutes,
          'freshness_source', freshness_source, 'level', 'critical'));
    elsif stale_min >= rec.warn_after_minutes then
      perform public.mon_raise('P2', 'stale_refresh', rec.object_name, 'stale_refresh:'||rec.object_name,
        jsonb_build_object('object', rec.object_name, 'last_refresh', last_refresh,
          'stale_minutes', round(stale_min), 'warn_after_minutes', rec.warn_after_minutes,
          'freshness_source', freshness_source, 'level', 'warning'));
    else
      perform public.mon_resolve('stale_refresh', rec.object_name);
    end if;
  end loop;
  return (select count(*) from public.alert_event where kind='stale_refresh' and resolved_at is null and dispatched_at is null);
end $$;

-- ── fold D6 into the existing orchestrator (redefines mon_run_all_detectors from Batch 0 to
-- add one more key; D1-D5 bodies are untouched, this is purely additive to the returned jsonb).
create or replace function public.mon_run_all_detectors()
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a int; b int; c int; d int; e int; f int;
begin
  a := public.mon_detect_silent_scraper_death();
  b := public.mon_detect_zero_new_stall();
  c := public.mon_detect_stale_active_fraction();
  d := public.mon_detect_volume_drop();
  e := public.mon_detect_cron_health();
  f := public.mon_detect_stale_refresh();
  return jsonb_build_object('silent_scraper_death',a,'zero_new_stall',b,'stale_active',c,
    'volume_drop',d,'cron_health',e,'stale_refresh',f,'ran_at',now());
end $$;

-- ═══════════════════════ FOLLOW-UP (owner-gated — NOT run by this migration) ═════════════════
-- Makes mon_mv_refresh_log authoritative instead of the pg_stat_last_analyze proxy. Edits two
-- LIVE cron.job commands, so per the PR-based-deploy-workflow + approval-workflow rules this
-- is staged here for review, not applied automatically.
--
-- select cron.alter_job(16, command =>
--   $cmd$set statement_timeout to '1200s';
--        refresh materialized view concurrently public.listing_location_index;
--        refresh materialized view concurrently public.listing_location_canonical_mv;
--        analyze public.listing_location_index;
--        analyze public.listing_location_canonical_mv;
--        insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after) values
--          ('listing_location_index', now(), (select count(*) from public.listing_location_index)),
--          ('listing_location_canonical_mv', now(), (select count(*) from public.listing_location_canonical_mv))
--        on conflict (object_name) do update set refreshed_at=excluded.refreshed_at, rows_after=excluded.rows_after;$cmd$);
--
-- select cron.alter_job(17, command =>
--   $cmd$set statement_timeout to '900s';
--        refresh materialized view concurrently public.active_listing_ids_v2;
--        refresh materialized view concurrently public.listing_native_location_v1;
--        analyze public.active_listing_ids_v2;
--        analyze public.listing_native_location_v1;
--        insert into public.mon_mv_refresh_log(object_name, refreshed_at, rows_after) values
--          ('active_listing_ids_v2', now(), (select count(*) from public.active_listing_ids_v2)),
--          ('listing_native_location_v1', now(), (select count(*) from public.listing_native_location_v1))
--        on conflict (object_name) do update set refreshed_at=excluded.refreshed_at, rows_after=excluded.rows_after;$cmd$);
--
-- Once both land, re-run mon_detect_stale_refresh() once and confirm the two alert details show
-- freshness_source='mon_mv_refresh_log (authoritative)' before considering the interim proxy
-- retired.
-- ─────────────────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (additive only, safe to drop cleanly):
--   BEGIN;
--   -- restore mon_run_all_detectors to its Batch 0 (5-detector) definition first if D6 is
--   -- being removed but Batch 0 itself is staying — see 20260713_batch0_detection_spine.sql
--   -- for the exact D1-D5-only body to restore.
--   DELETE FROM public.alert_event WHERE kind = 'stale_refresh';
--   DROP FUNCTION IF EXISTS public.mon_detect_stale_refresh();
--   DROP TABLE IF EXISTS public.mon_mv_refresh_log;
--   DROP TABLE IF EXISTS public.mon_refresh_targets;
--   COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────────────────


-- ── AUTO-REGISTRATION: new platforms inherit monitoring protection for free ──────────────────
-- Appended to Batch 0 (supabase/migrations/20260713_batch0_detection_spine.sql, PR #69, NOT
-- merged). Closes the "platform_registry is a static INSERT...VALUES list" gap: today a new
-- scraper is INVISIBLE to every detector until a human remembers to hand-add a row. This trigger
-- makes the FIRST scrape_runs row for any platform double as its registration, with sane
-- defaults the operator can immediately override.
--
-- DB trigger (not a Python-side change in scrapers/common/db.py::begin_run) because scrape_runs
-- is the one place every scraper writes before every run, regardless of whether it goes through
-- the shared begin_run() helper — this protects even a stray script or a future non-Python
-- scraper that inserts into scrape_runs directly. A begin_run()-only upsert would silently miss
-- any caller that doesn't import that helper.
create or replace function public.mon_auto_register_platform()
 returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  -- Skip ':'-namespaced pseudo-runs (liveness/cleanup sub-runs) — same convention already used
  -- by mon_detect_silent_scraper_death's "platform !~ ':'" filter; these aren't real platforms
  -- and shouldn't get their own platform_registry row.
  if new.platform is not null and new.platform !~ ':' then
    -- ON CONFLICT DO NOTHING is the whole safety contract: if the platform already has a
    -- registry row — whether hand-seeded 'active', demoted to 'dormant', or 'retired' — this
    -- insert is a complete no-op. It NEVER updates status, expected_cadence_hours, or notes on
    -- an existing row, so a stray/legacy begin_run() call for a retired platform (e.g. toor)
    -- can not resurrect it to 'active'. Only a genuinely first-ever platform name gets a row.
    insert into public.platform_registry (platform, status, expected_cadence_hours)
    values (new.platform, 'active', 24)
    on conflict (platform) do nothing;
  end if;
  return new;
end $$;

create or replace trigger trg_auto_register_platform
before insert on public.scrape_runs
for each row
execute function public.mon_auto_register_platform();

-- Operator override, post-auto-insert (unchanged mechanism, just documenting it explicitly):
--   update public.platform_registry set status='dormant', expected_cadence_hours=48,
--     notes='seasonal, low cadence by design' where platform='some_new_platform';
-- This is a normal UPDATE against an existing row — the trigger never runs again for a platform
-- that already exists, so an operator's override is permanent until they change it again.

-- ROLLBACK (additive only, safe to drop):
--   BEGIN;
--   DROP TRIGGER IF EXISTS trg_auto_register_platform ON public.scrape_runs;
--   DROP FUNCTION IF EXISTS public.mon_auto_register_platform();
--   COMMIT;