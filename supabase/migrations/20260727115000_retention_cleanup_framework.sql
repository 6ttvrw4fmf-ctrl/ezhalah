-- Unified production cleanup / retention framework (owner-approved 2026-07-26, gradual rollout).
-- Generalizes the aqar/wasalt-only 30-day hard-delete into ONE config-driven lifecycle that every
-- platform inherits: active → inactive → eligible (age + liveness signal) → source-reverified-gone
-- → permanently deleted. Ships DEFAULT-DENY: a platform with no row here (or enabled=false) deletes
-- NOTHING, so adding a new scraper never silently starts deleting. The engine lives in
-- scrapers/common/cleanup.py; this migration is only the config + audit + monitoring surface.

-- ── Per-platform policy. Missing row ⇒ engine uses these defaults with enabled=false (default-deny),
-- so new platforms "inherit the lifecycle" (disabled) automatically without any code change.
create table if not exists public.platform_retention_policy (
  platform               text primary key,
  min_inactive_days      int      not null default 30,   -- last_seen_at must be older than this
  min_missing_count      int      not null default 3,    -- historical liveness misses required
  require_source_recheck boolean  not null default true,  -- re-fetch the real listing_url before delete
  max_delete_per_run     int      not null default 500,   -- hard cap; a run can never exceed this
  anomaly_floor          int      not null default 300,   -- below this many candidates, never treat as a spike
  anomaly_factor         numeric  not null default 4,     -- candidates > factor × trailing-median ⇒ ABORT
  enabled                boolean  not null default false,
  note                   text
);

-- aqar/wasalt: documented here but STILL enabled=false in the engine — the legacy aqar-cleanup.yml /
-- wasalt-cleanup.yml keep running them until they're deliberately migrated onto the engine (so we
-- never have two paths deleting the same table at once). Every other platform: no row = default-deny.
insert into public.platform_retention_policy (platform, require_source_recheck, note) values
  ('aqar',   true, 'liveness-grade missing_count (daily HTTP check). Handled by legacy aqar-cleanup until migrated to engine.'),
  ('wasalt', true, 'enum-strike missing_count (daily). Handled by legacy wasalt-cleanup until migrated to engine.')
on conflict (platform) do nothing;

-- ── Run history: one row per (platform, run). Feeds the anomaly baseline + the deletion report + the
-- spike detector. begin_run/end_run still log to scrape_runs for the fleet-wide health view; this is
-- the cleanup-specific audit.
create table if not exists public.cleanup_runs (
  id          bigint generated always as identity primary key,
  platform    text        not null,
  ran_at      timestamptz not null default now(),
  dry_run     boolean     not null default false,
  candidates  int         not null default 0,
  rechecked   int         not null default 0,
  deleted     int         not null default 0,
  reactivated int         not null default 0,   -- source re-check found it LIVE → self-healed, not deleted
  skipped     int         not null default 0,   -- unknown/blocked/transient → never deleted
  aborted     boolean     not null default false,
  abort_reason text
);
create index if not exists idx_cleanup_runs_platform_time on public.cleanup_runs (platform, ran_at desc);

-- ── Per-row deletion audit ("detailed deletion report": exactly why each row qualified).
-- reason jsonb = {inactive_days, missing_count, http_status, verdict:'dead', markers?}.
create table if not exists public.cleanup_deletion_log (
  id           bigint generated always as identity primary key,
  run_id       bigint,
  platform     text        not null,
  source_table text        not null,
  listing_id   bigint,
  ad_number    text,
  listing_url  text,
  reason       jsonb       not null,
  deleted_at   timestamptz not null default now()
);
create index if not exists idx_cleanup_deletion_log_run on public.cleanup_deletion_log (run_id);

-- Internal audit/config tables — service-role only (scraper writes bypass RLS). RLS on + no anon
-- policy = anon cannot read/write. (Matches the "no PII / internal ops state stays server-side" posture.)
alter table public.platform_retention_policy enable row level security;
alter table public.cleanup_runs             enable row level security;
alter table public.cleanup_deletion_log     enable row level security;

-- ── Secondary safety net (the in-engine anomaly ABORT is primary). Alerts P1 if a completed run
-- deleted more than max(floor, factor × that platform's trailing-30d median deleted) — or aborted.
create or replace function public.mon_detect_deletion_spike()
 returns integer language plpgsql security definer set search_path to 'public' as $$
declare rec record; n int := 0; med numeric; thresh numeric; floor_n int; factor numeric;
begin
  for rec in
    select r.*, p.anomaly_floor, p.anomaly_factor
    from public.cleanup_runs r
    left join public.platform_retention_policy p on p.platform = r.platform
    where r.ran_at > now() - interval '2 days' and not r.dry_run
  loop
    floor_n := coalesce(rec.anomaly_floor, 300);
    factor  := coalesce(rec.anomaly_factor, 4);
    if rec.aborted then
      n := n + public.mon_raise('P1','deletion_spike', rec.platform,
        'deletion_spike:'||rec.platform||':'||rec.id::text,
        jsonb_build_object('event','ABORTED','reason',rec.abort_reason,'candidates',rec.candidates,'ran_at',rec.ran_at));
      continue;
    end if;
    select coalesce(percentile_cont(0.5) within group (order by h.deleted),0) into med
      from public.cleanup_runs h
     where h.platform = rec.platform and not h.dry_run and h.ran_at < rec.ran_at and h.ran_at > rec.ran_at - interval '30 days';
    thresh := greatest(floor_n, factor * med);
    if rec.deleted > thresh then
      n := n + public.mon_raise('P1','deletion_spike', rec.platform,
        'deletion_spike:'||rec.platform||':'||rec.id::text,
        jsonb_build_object('event','SPIKE','deleted',rec.deleted,'threshold',round(thresh),'median_30d',round(med),'ran_at',rec.ran_at));
    end if;
  end loop;
  return n;
end $$;

-- Wire mon_detect_deletion_spike into the hourly runner (rebuilt from the LIVE pg_get_functiondef
-- 2026-07-27: 13 detectors a..m + the new one = n; same zero-arg signature, no overload).
create or replace function public.mon_run_all_detectors()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; j int; k int; l int; m int; nn int;
begin
  a := public.mon_detect_silent_scraper_death();
  b := public.mon_detect_zero_new_stall();
  c := public.mon_detect_stale_active_fraction();
  d := public.mon_detect_volume_drop();
  e := public.mon_detect_cron_health();
  f := public.mon_detect_stale_refresh();
  g := public.mon_detect_legacy_alert_tables();
  h := public.mon_detect_field_integrity();
  i := public.mon_detect_search_index_freshness();
  j := public.mon_detect_quarantine_growth();
  k := public.mon_detect_registry_orphans();
  l := public.mon_detect_rls_reachability();
  m := public.mon_detect_mass_inactivation();
  nn := public.mon_detect_deletion_spike();
  return jsonb_build_object('silent_scraper_death',a,'zero_new_stall',b,'stale_active',c,
    'volume_drop',d,'cron_health',e,'stale_refresh',f,'legacy_alert_tables',g,
    'field_integrity',h,'search_index_freshness',i,'quarantine_growth',j,
    'registry_orphans',k,'rls_reachability',l,'mass_inactivation',m,'deletion_spike',nn,'ran_at',now());
end $function$;
