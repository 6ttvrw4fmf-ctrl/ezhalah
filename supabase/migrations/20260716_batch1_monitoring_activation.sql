-- ─────────────────────────────────────────────────────────────────────────────────────────
-- BATCH 1 — MONITORING ACTIVATION (hardening follow-on to Batch 0,
-- 20260713_batch0_detection_spine.sql — read that file first; every convention here extends it).
-- Three sections:
--   §1  a human alert channel (ops_alert_channel) + per-alert webhook fan-out in
--       mon_dispatch_alerts(), so a raised alert can actually reach a person;
--   §2  retired-platform suppression for the EXISTING live check_scraper_freshness()
--       alerting (jobid 31, every 6h) — toor/alnokhba/muktamel have fired identical
--       warning/critical rows every run for weeks (58/46/60 rows in
--       scraper_freshness_alerts as of 2026-07-16, all noise, still firing);
--   §3  the activation cron Batch 0 deliberately left commented out ("inert until
--       activated") — one job running mon_run_all_detectors() + mon_dispatch_alerts()
--       every 30 minutes.
--
-- WHY NOW: Batch 0 built the spine but nothing schedules it, so every detector is dark; and
-- the one alerting path that IS live (scraper-freshness-check) is drowning in retired-platform
-- spam, which is exactly the alert-fatigue failure mode the hardening audit called out.
--
-- NEUTRALITY: alert-only, same as Batch 0. Never modifies a listing, never classifies, never
-- hides a source. §2 changes WHICH platforms an ops alert fires for — it does not change any
-- search/UI behavior.
--
-- NEVER BLOCKS: every webhook POST in §1 is exception-wrapped so a bad URL / pg_net hiccup can
-- never fail the dispatcher or roll back the detectors that share its cron transaction.
-- ─────────────────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════ §1 · HUMAN ALERT CHANNEL ═══════════════════════════════════════

-- One row per destination webhook (Slack/Teams/relay). Kept separate from mon_config's single
-- alert_webhook_url (which stays supported, unchanged) so the owner can register several
-- destinations, disable one without deleting it, and annotate each. CONTAINS A SECRET URL →
-- RLS enabled with NO public read policy; service-role only, mirroring mon_refresh_targets'
-- convention in Batch 0.
create table if not exists public.ops_alert_channel (
  id          bigint generated always as identity primary key,
  kind        text not null default 'webhook',
  webhook_url text not null,
  enabled     boolean not null default true,
  note        text,
  created_at  timestamptz default now()
);
alter table public.ops_alert_channel enable row level security;   -- no policies on purpose:
revoke all on public.ops_alert_channel from public, anon, authenticated;
grant select, insert, update, delete on public.ops_alert_channel to service_role;

-- Dispatcher v2 (replaces the Batch 0 definition — same signature, same return meaning: number
-- of alert rows newly stamped dispatched_at). What's kept and what's new:
--   KEPT   · the aggregate POST to mon_config.alert_webhook_url (if the owner ever sets it),
--            same payload shape as Batch 0;
--   KEPT   · the dead-man's-switch GET to mon_config.deadman_ping_url;
--   KEPT   · dispatched_at as the one at-most-once marker — no new column needed;
--   NEW    · per-alert × per-enabled-channel fan-out: each newly-dispatched alert row is POSTed
--            individually (compact JSON: severity/kind/platform/dedup_key/detail/raised_at) to
--            every enabled ops_alert_channel row;
--   NEW    · every POST is exception-wrapped (per-post AND around the whole fan-out) so a bad
--            channel URL can never fail the function or take down the co-scheduled detectors.
-- LAUNCH STATE: zero ops_alert_channel rows + null alert_webhook_url → the webhook step is a
-- clean no-op and alerts stay undispatched (dispatched_at null), so the FIRST destination the
-- owner configures receives the whole backlog — identical to Batch 0's behavior.
-- AT-MOST-ONCE: the undispatched batch is snapshotted once, fanned out once, then stamped.
-- A channel added later never re-receives already-dispatched alerts. pg_net's http_post only
-- QUEUES the request (async worker delivers), so "POST issued" here means enqueued; a failing
-- destination surfaces in net._http_response, never as a dispatcher error.
create or replace function public.mon_dispatch_alerts()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  hook text; deadman text; payload jsonb; n int := 0;
  batch bigint[];
  al record; ch record;
  delivered boolean := false;
begin
  select value into hook    from public.mon_config where key='alert_webhook_url';
  select value into deadman from public.mon_config where key='deadman_ping_url';

  -- snapshot the undispatched batch ONCE so the aggregate hook and the per-channel fan-out see
  -- the same rows, and the dispatched_at stamp below covers exactly what was sent (an alert
  -- raised concurrently mid-dispatch simply waits for the next run).
  select array_agg(id) into batch
  from public.alert_event where dispatched_at is null and resolved_at is null;

  if batch is not null then
    -- legacy aggregate webhook (Batch 0 behavior, now exception-guarded)
    if hook is not null then
      begin
        select jsonb_build_object(
                 'source','ezhalah-monitoring','sent_at',now(),
                 'open_alerts', (select count(*) from public.alert_event where resolved_at is null),
                 'new', coalesce(jsonb_agg(jsonb_build_object('sev',severity,'kind',kind,'platform',platform,'detail',detail)),'[]'::jsonb))
          into payload
          from public.alert_event where id = any(batch);
        perform net.http_post(url := hook, headers := '{"Content-Type":"application/json"}'::jsonb, body := payload);
        delivered := true;
      exception when others then
        raise notice 'mon_dispatch_alerts: aggregate webhook post failed (%), continuing', sqlerrm;
      end;
    end if;

    -- per-alert × per-channel fan-out — clean no-op when ops_alert_channel is empty
    begin
      for al in
        select id, severity, kind, platform, dedup_key, detail, created_at
        from public.alert_event where id = any(batch) order by id
      loop
        for ch in select id, webhook_url from public.ops_alert_channel where enabled order by id loop
          begin
            perform net.http_post(
              url     := ch.webhook_url,
              headers := '{"Content-Type":"application/json"}'::jsonb,
              body    := jsonb_build_object(
                'severity',  al.severity,
                'kind',      al.kind,
                'platform',  al.platform,
                'dedup_key', al.dedup_key,
                'detail',    al.detail,
                'raised_at', al.created_at));
            delivered := true;
          exception when others then
            raise notice 'mon_dispatch_alerts: channel % post failed (%), continuing', ch.id, sqlerrm;
          end;
        end loop;
      end loop;
    exception when others then
      raise notice 'mon_dispatch_alerts: channel fan-out failed (%), continuing', sqlerrm;
    end;

    -- stamp only if at least one destination actually received the batch — otherwise leave the
    -- alerts undispatched so the first configured destination gets the backlog (launch state).
    if delivered then
      update public.alert_event set dispatched_at = now() where id = any(batch) and dispatched_at is null;
      get diagnostics n = row_count;
    end if;
  end if;

  begin
    if deadman is not null then perform net.http_get(url := deadman); end if;  -- "I'm alive"
  exception when others then
    raise notice 'mon_dispatch_alerts: dead-man ping failed (%), continuing', sqlerrm;
  end;
  return n;
end $$;


-- ═══════════════════════ §2 · RETIRED-PLATFORM SUPPRESSION (live alerting) ═══════════════

-- The is_active design comes from 20260714_1600_scraper_run_health_reconciliation.sql (designed,
-- never applied — verified 2026-07-16: platform_cadence live has only platform/expected_hours/
-- note). Semantics HERE: is_active=false ⇒ "this platform is not supposed to be producing fresh
-- listings; do not page anyone about its staleness". Default true (and a missing row also means
-- true) ⇒ zero behavior change for every active platform.
--
-- ⚠ COMPATIBILITY NOTE for whoever later applies 20260714_1600_...: its seed list sets
-- aqarmonthly is_active=false because aqarmonthly never writes scrape_runs (a
-- reconciliation-scope exclusion). Under THIS migration's semantics that same flag would
-- silently disable check_scraper_freshness() for aqarmonthly — its ONLY freshness monitor.
-- If that design ever lands, its aqarmonthly seed row MUST be dropped/re-reviewed first.
alter table public.platform_cadence
  add column if not exists is_active boolean not null default true;

-- Seed the three spammers. Live platform_cadence (verified 2026-07-16) has NO row for toor or
-- alnokhba — a bare UPDATE would silently miss both — so this is an upsert. expected_hours=24
-- for the two new rows matches the coalesce(...,24) default the live function already applies
-- to them today (no behavior change for any other reader); muktamel's existing expected_hours
-- (168) is deliberately NOT in the conflict SET list, so it is preserved.
insert into public.platform_cadence (platform, expected_hours, note, is_active) values
  ('toor',     24,  'retired 2026-07-06 (host IP-blocks; Fleet audit) — excluded from check_scraper_freshness; fired 58 identical stale alerts 2026-07-06→07-16 before this', false),
  ('alnokhba', 24,  'deprecated 2026-07-14 (domain lapsed to a parking page; removed from small-sources-sync.yml) — excluded from check_scraper_freshness; fired 46 identical stale alerts before this', false),
  ('muktamel', 168, 'weekly (jobid 14) — PAUSED 2026-07-14 via cron.alter_job(14, active=>false), scope was pause-only NOT deprecate (see 20260714_pause_muktamel_cron.sql); excluded from check_scraper_freshness while paused; fired 60 identical stale alerts before this', false)
on conflict (platform) do update set is_active = false, note = excluded.note;

-- check_scraper_freshness v2. Byte-identical to the LIVE 2026-07-16 definition (extracted via
-- pg_get_functiondef / prosrc, project aannarbkwcymrotzwdbo) EXCEPT the single marked
-- "skip if is_active=false" block at the top of the loop. Same signature, same insert target
-- (scraper_freshness_alerts), same thresholds (warn > 2×expected_hours, critical > 6×), same
-- 'deal\_%' table exclusion, same coalesce(...,24) cadence default for platforms with no
-- cadence row. Consumers (jobid 31) are untouched — the job keeps calling the same name.
create or replace function public.check_scraper_freshness()
 returns table(platform text, last_scraped_at timestamptz, hours_stale numeric, expected_hours integer, severity text)
 language plpgsql security definer set search_path to 'public' as $$
declare rec record; t text; m timestamptz; latest timestamptz; exp int; hs numeric; sev text;
begin
  for rec in
    select regexp_replace(tablename,'_(residential|commercial)_listings$','') as p,
           array_agg(tablename) as tabs
    from pg_tables
    where schemaname='public' and tablename ~ '_(residential|commercial)_listings$'
      and tablename not like 'deal\_%'
    group by 1
  loop
    -- BATCH 1 (the ONLY change vs the live definition): a platform explicitly flagged
    -- is_active=false in platform_cadence is not supposed to have fresh data — skip it
    -- entirely instead of paging about staleness forever. No cadence row / is_active=true
    -- ⇒ identical behavior to before.
    if exists (select 1 from platform_cadence pc
               where pc.platform = rec.p and pc.is_active = false) then
      continue;
    end if;
    latest := null;
    foreach t in array rec.tabs loop
      execute format('select greatest(max(scraped_at), max(last_seen_at)) from public.%I', t) into m;
      if m is not null and (latest is null or m > latest) then latest := m; end if;
    end loop;
    select coalesce((select pc.expected_hours from platform_cadence pc where pc.platform = rec.p), 24)
      into exp;
    hs := round((extract(epoch from (now() - coalesce(latest, 'epoch'::timestamptz))) / 3600.0)::numeric, 1);
    if hs > 2 * exp then
      sev := case when hs > 6 * exp then 'critical' else 'warning' end;
      insert into scraper_freshness_alerts(platform, last_scraped_at, hours_stale, expected_hours, severity)
      values (rec.p, latest, hs, exp, sev);
      platform := rec.p; last_scraped_at := latest; hours_stale := hs; expected_hours := exp; severity := sev;
      return next;
    end if;
  end loop;
end $$;

-- platform_registry seed reconciliation (Batch 0's seed list, re-verified 2026-07-16):
--   toor     'retired' ✓ correct (retired 2026-07-06, host IP-blocks) — no change;
--   alnokhba 'retired' ✓ correct (deprecated 2026-07-14, domain lapsed) — no change;
--   muktamel 'retired' ✗ WRONG — 20260714_pause_muktamel_cron.sql explicitly scoped the action
--            as "pause the cron job", NOT "deprecate the platform" (jobid 14 was alter_job'd
--            inactive, reversibly, and Batch 0's own seed note even says "dormant"). The
--            registry's correct vocabulary for paused-might-return is 'dormant'. Functionally
--            identical for every detector (they all filter status='active'), but the registry
--            is the single source of truth for platform status and should say what is true.
-- Fixed here via upsert (Batch 0's already-merged file is not edited). Ordering note: this
-- migration sorts after 20260713_batch0_detection_spine.sql, so on a fresh replay the Batch 0
-- seed lands first and this correction lands second — the final state is always 'dormant'.
insert into public.platform_registry (platform, status, expected_cadence_hours, notes) values
  ('muktamel', 'dormant', 9999, 'paused 2026-07-14 via cron.alter_job(14, active=>false) — pause-only, NOT deprecated (20260714_pause_muktamel_cron.sql); 0 rows ever active; status corrected retired→dormant by Batch 1 to match the pause intent')
on conflict (platform) do update
  set status = excluded.status, notes = excluded.notes, updated_at = now();


-- ═══════════════════════ §3 · ACTIVATION CRON (turns the Batch 0 spine ON) ═══════════════

-- ONE job, not the two commented in Batch 0's activation block: detectors and dispatch run
-- back-to-back in the same command so dispatch always sees the alerts the sweep just raised
-- (no :20/:25 phase gap), and §1's never-throws dispatcher makes co-scheduling safe.
--
-- Idempotent: unschedule-by-name first. cron.unschedule('name') RAISES if the job doesn't
-- exist, so the guarded jobid form is used instead — it returns 0 rows (a clean no-op) when
-- the job has never been scheduled, and unschedules exactly the named job when re-applying.
-- (Naming-collision check against live cron.job, 2026-07-16: no jobname matching 'mon-%'
-- exists; 'mon-detectors-and-dispatch' is free.)
select cron.unschedule(jobid) from cron.job where jobname = 'mon-detectors-and-dispatch';

-- '20,50 * * * *' = every 30 minutes, phase-shifted off the crowded :00/:15/:45 slots (jobid 17
-- refreshes two MVs at :00 with a 900s budget; 28 syncs at :15; 24/29/34 run at :45-:50) and
-- aligned with the :20 phase Batch 0's commented activation block already chose. The 300s
-- statement_timeout follows the live convention (jobids 16/17/28/29 all set one inline;
-- location-selftest uses this exact '300s' budget) — the full 6-detector sweep measured 0.44s
-- in the 2026-07-16 BEGIN/ROLLBACK test against live prod (dispatch is sub-second: pg_net only
-- ENQUEUES posts), so 300s is enormous headroom while still guaranteeing a wedged sweep can
-- never hold a connection for hours.
select cron.schedule(
  'mon-detectors-and-dispatch',
  '20,50 * * * *',
  $job$
    set statement_timeout to '300s';
    select public.mon_run_all_detectors();
    select public.mon_dispatch_alerts();
  $job$
);

-- Owner wiring (post-deploy, NOT in git — the URL is a secret):
--   insert into public.ops_alert_channel (webhook_url, note)
--   values ('<https://hooks.slack.com/... or relay>', 'primary human channel');
-- and optionally the Batch 0 aggregate/dead-man config:
--   update public.mon_config set value='<webhook>'          where key='alert_webhook_url';
--   update public.mon_config set value='<https://hc-ping…>' where key='deadman_ping_url';


-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (additive + one function-body swap; safe to undo cleanly):
--   BEGIN;
--   select cron.unschedule(jobid) from cron.job where jobname = 'mon-detectors-and-dispatch';
--   -- restore mon_dispatch_alerts to its Batch 0 definition
--   --   (see 20260713_batch0_detection_spine.sql, "dispatcher" section);
--   -- restore check_scraper_freshness to the pre-Batch-1 definition
--   --   (the §2 body above minus the marked skip block IS that definition, verbatim);
--   DROP TABLE IF EXISTS public.ops_alert_channel;
--   ALTER TABLE public.platform_cadence DROP COLUMN IF EXISTS is_active;
--   -- (optional) revert the registry correction:
--   -- update public.platform_registry set status='retired', updated_at=now() where platform='muktamel';
--   COMMIT;
-- Note: dropping is_active also discards the three seeded exclusion notes — pure bookkeeping,
-- no other reader. scraper_freshness_alerts rows raised before/after are untouched history.
-- ─────────────────────────────────────────────────────────────────────────────────────────
