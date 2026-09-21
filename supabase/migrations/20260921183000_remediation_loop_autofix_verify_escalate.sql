-- THE REMEDIATION LOOP: detect -> safely auto-fix -> VERIFY against production -> resolve only if
-- genuinely gone, else ESCALATE. Nothing important sits unfixed forever.
--
-- WHY (owner mandate, 2026-09-21). Detection is strong (~270 detectors); the weak link is that
-- detected problems sit in the queue unhandled (2 of 1,014 alerts ever acknowledged; oldest open 41
-- days). This adds the missing half: a worker that, for alert kinds with a KNOWN SAFE deterministic
-- fix, runs the fix, RE-CHECKS the real production condition, and closes the alert ONLY when the
-- condition is verified gone — and when a fix keeps failing, raises ONE escalation instead of
-- retrying forever or spamming. Judgment-required kinds are deliberately NOT auto-fixed; they keep
-- their owner and their age-escalation (migration 20260921091500).
--
-- SAFETY (all owner rules honoured):
--  * "fix executed" is never success — verify_fn re-reads production; close only if it returns true.
--  * Never auto-fix judgment calls — a kind is auto-fixed ONLY if explicitly registered with a
--    fix_fn in ops_remediation_policy. Default is escalate-only.
--  * Guardrails: per-alert cooldown, per-alert max_attempts, a global per-run cap, and a
--    mon_config kill switch (remediation_enabled). Each fix runs in its own subtransaction so one
--    failure neither aborts the sweep nor leaves a half-applied change.
--  * Idempotent by construction: verify-before-close, and registered fix_fns must be re-runnable.
--  * Every attempt is logged (ops_remediation_attempt) and every sweep heartbeats
--    (ops_remediation_run) so the worker itself is watchable (mon_detect_remediation_worker_stale).

-- ── Registry: which kinds have a safe auto-fix, and how to verify it ──────────────────────────
create table if not exists public.ops_remediation_policy (
  kind             text primary key,
  fix_fn           text,                       -- public.<fn>(p_dedup text, p_platform text) returns void; NULL = escalate-only
  verify_fn        text not null,              -- public.<fn>(p_dedup text, p_platform text) returns boolean = condition CLEARED?
  max_attempts     int  not null default 3,
  cooldown_minutes int  not null default 60,
  enabled          boolean not null default true,
  note             text,
  registered_at    timestamptz not null default now()
);
comment on table public.ops_remediation_policy is
  'Auto-remediation registry. A kind is auto-fixed ONLY if it has a row here with fix_fn set and '
  'enabled. fix_fn must be idempotent; verify_fn re-reads production and returns true when the '
  'original condition is gone. A row with fix_fn NULL is escalate-only (judgment required).';

-- ── Attempt log: idempotency, rate-limit source of truth, and the metrics substrate ──────────
create table if not exists public.ops_remediation_attempt (
  id           bigserial primary key,
  kind         text not null,
  dedup_key    text not null,
  platform     text,
  attempted_at timestamptz not null default now(),
  attempt_no   int  not null,
  fix_fn       text,
  fix_ok       boolean,       -- did the fix command run without error?
  verified     boolean,       -- did production re-check show the condition cleared?
  error        text
);
create index if not exists ops_remediation_attempt_dedup on public.ops_remediation_attempt (dedup_key, attempted_at desc);

-- ── Worker heartbeat: so the remediation worker is itself watchable ──────────────────────────
create table if not exists public.ops_remediation_run (
  id             bigserial primary key,
  ran_at         timestamptz not null default now(),
  considered     int not null default 0,
  attempted      int not null default 0,
  verified_fixed int not null default 0,
  escalated      int not null default 0,
  duration_ms    numeric
);

insert into public.mon_config (key, value, note) values
  ('remediation_enabled', 'true', 'Kill switch for run_remediation(). Set to anything other than true to pause ALL auto-fixing (detection + escalation continue).'),
  ('remediation_max_fixes_per_run', '50', 'Global guardrail: max fix attempts per run_remediation() sweep, so a bad registration cannot storm production.')
on conflict (key) do nothing;

-- ── A real, safe, idempotent registered fix: orphaned scrape_runs ─────────────────────────────
-- mon_reconcile_dangling_scrape_runs() closes runs stuck >12h (killed before end_run()). Idempotent
-- (already-closed rows are untouched). Verify = the detector's own self-heal condition: no dangling
-- run remains for this platform in the 3-48h window.
create or replace function public.remediate_dangling_scrape_run(p_dedup text, p_platform text)
 returns void language plpgsql security definer set search_path to 'public'
as $fn$
begin
  perform public.mon_reconcile_dangling_scrape_runs();
end $fn$;

create or replace function public.verify_dangling_scrape_run(p_dedup text, p_platform text)
 returns boolean language sql security definer set search_path to 'public'
as $fn$
  select not exists (
    select 1 from public.scrape_runs s
    where s.platform = p_platform
      and s.ok is null and s.finished_at is null
      and s.started_at between now() - interval '48 hours' and now() - interval '3 hours');
$fn$;

insert into public.ops_remediation_policy (kind, fix_fn, verify_fn, max_attempts, cooldown_minutes, note) values
  ('dangling_scrape_run', 'remediate_dangling_scrape_run', 'verify_dangling_scrape_run', 3, 30,
   'Closes scrape_runs killed before end_run() (>12h). Idempotent; verify = no dangling run left for the platform.')
on conflict (kind) do update set fix_fn=excluded.fix_fn, verify_fn=excluded.verify_fn, note=excluded.note;

-- ── THE WORKER ────────────────────────────────────────────────────────────────────────────────
create or replace function public.run_remediation()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_started timestamptz := clock_timestamp();
  v_cap int := coalesce((select value from public.mon_config where key='remediation_max_fixes_per_run')::int, 50);
  v_enabled boolean := coalesce((select value from public.mon_config where key='remediation_enabled') = 'true', false);
  a record; pol record;
  v_considered int := 0; v_attempted int := 0; v_fixed int := 0; v_escalated int := 0;
  v_attempts_today int; v_last timestamptz; v_attempt_no int;
  v_fix_ok boolean; v_verified boolean; v_err text;
begin
  if not v_enabled then
    insert into public.ops_remediation_run(considered, attempted, verified_fixed, escalated, duration_ms)
      values (0,0,0,0, 0);
    return jsonb_build_object('disabled', true);
  end if;

  for a in
    select ae.kind, ae.dedup_key, ae.platform
      from public.alert_event ae
      join public.ops_remediation_policy p on p.kind = ae.kind
     where ae.resolved_at is null
       and p.enabled and p.fix_fn is not null
     order by ae.severity, ae.created_at   -- worst + oldest first
  loop
    v_considered := v_considered + 1;
    if v_attempted >= v_cap then exit; end if;               -- global guardrail
    select * into pol from public.ops_remediation_policy where kind = a.kind;

    select count(*), max(attempted_at)
      into v_attempts_today, v_last
      from public.ops_remediation_attempt
     where dedup_key = a.dedup_key and attempted_at > now() - interval '24 hours';

    -- cooldown (rate limit + idempotency): do not re-attempt within the cooldown window
    if v_last is not null and v_last > now() - make_interval(mins => pol.cooldown_minutes) then
      continue;
    end if;

    -- exhausted: escalate ONCE (deduped per problem), then stop attempting
    if v_attempts_today >= pol.max_attempts then
      v_escalated := v_escalated + public.mon_raise('P0', 'remediation_exhausted', a.platform,
        'remediation_exhausted:' || a.dedup_key,
        jsonb_build_object('failed_kind', a.kind, 'dedup_key', a.dedup_key, 'platform', a.platform,
          'attempts_24h', v_attempts_today, 'max_attempts', pol.max_attempts,
          'why', 'Auto-fix ran ' || v_attempts_today || ' times in 24h and production still shows the '
              || 'condition. This is no longer a safe automatic fix; a human/owner routine must take it.',
          'action', 'Investigate ' || a.kind || ' for ' || coalesce(a.platform,'(none)')
              || '; see ops_remediation_attempt for the errors. Resolves automatically once verify passes.'));
      continue;
    end if;

    v_attempt_no := v_attempts_today + 1;
    v_attempted := v_attempted + 1;
    v_fix_ok := false; v_err := null;

    -- run the fix in its OWN subtransaction so an error neither aborts the sweep nor half-applies
    begin
      execute format('select public.%I($1,$2)', pol.fix_fn) using a.dedup_key, a.platform;
      v_fix_ok := true;
    exception when others then
      v_fix_ok := false; v_err := sqlerrm;
    end;

    -- VERIFY against production regardless of whether the fix "ran" — executed != fixed
    begin
      execute format('select public.%I($1,$2)', pol.verify_fn) into v_verified using a.dedup_key, a.platform;
    exception when others then
      v_verified := false; v_err := coalesce(v_err,'') || ' verify_error: ' || sqlerrm;
    end;

    insert into public.ops_remediation_attempt(kind, dedup_key, platform, attempt_no, fix_fn, fix_ok, verified, error)
      values (a.kind, a.dedup_key, a.platform, v_attempt_no, pol.fix_fn, v_fix_ok, coalesce(v_verified,false), v_err);

    if coalesce(v_verified, false) then
      perform public.mon_resolve_key(a.kind, a.dedup_key);                 -- close ONLY when verified gone
      perform public.mon_resolve_key('remediation_exhausted', 'remediation_exhausted:' || a.dedup_key);
      v_fixed := v_fixed + 1;
    elsif v_attempt_no >= pol.max_attempts then
      -- last allowed attempt just failed verification → escalate now, do not wait a full day
      v_escalated := v_escalated + public.mon_raise('P0', 'remediation_exhausted', a.platform,
        'remediation_exhausted:' || a.dedup_key,
        jsonb_build_object('failed_kind', a.kind, 'dedup_key', a.dedup_key, 'platform', a.platform,
          'attempts_24h', v_attempt_no, 'max_attempts', pol.max_attempts, 'last_error', v_err,
          'why', 'Auto-fix reached its attempt limit and production still shows the condition.',
          'action', 'A human/owner routine must take ' || a.kind || '; auto-resolves when verify passes.'));
    end if;
  end loop;

  insert into public.ops_remediation_run(considered, attempted, verified_fixed, escalated, duration_ms)
    values (v_considered, v_attempted, v_fixed, v_escalated,
            extract(epoch from clock_timestamp() - v_started) * 1000);

  return jsonb_build_object('considered', v_considered, 'attempted', v_attempted,
    'verified_fixed', v_fixed, 'escalated', v_escalated);
end $fn$;

-- ── Watchdog: the remediation worker must not silently stop ────────────────────────────────────
-- Runs inside the main detector sweep (itself watched by mon_watchdog_detector_job + the external
-- dead-man switch), so the worker is NOT the sole monitor of itself.
create or replace function public.mon_detect_remediation_worker_stale()
 returns integer language plpgsql security definer set search_path to 'public'
as $fn$
declare v_last timestamptz; n int := 0;
begin
  select max(ran_at) into v_last from public.ops_remediation_run;
  if v_last is null or v_last < now() - interval '2 hours' then
    n := public.mon_raise('P1', 'remediation_worker_stale', 'monitoring',
      'remediation_worker_stale',
      jsonb_build_object('last_ran_at', v_last, 'threshold_hours', 2,
        'why', 'run_remediation() has not recorded a sweep in over 2h. Auto-fixing is dark: '
            || 'detected problems with safe fixes are no longer being repaired. Detection and '
            || 'escalation still run, but the self-healing half is down.',
        'action', 'Check the run-remediation cron and mon_config.remediation_enabled.'));
  else
    perform public.mon_resolve_key('remediation_worker_stale', 'remediation_worker_stale');
  end if;
  return n;
end $fn$;

-- ── Metrics (area 10): one place to read whether remediation actually works ───────────────────
create or replace view public.mon_remediation_health as
select
  (select count(*) from alert_event where resolved_at is null) as open_incidents,
  (select count(*) from alert_event where resolved_at is null and severity='P0') as open_p0,
  (select count(*) from alert_event where resolved_at is null and severity='P1') as open_p1,
  (select round(extract(epoch from (now()-min(created_at)))/86400.0,1)
     from alert_event where resolved_at is null and severity in ('P0','P1')) as oldest_serious_days,
  (select count(*) from alert_event where resolved_at is null
     and last_affirmed_at is not null and last_affirmed_at < now()-interval '48 hours') as stale_unworked,
  (select count(*) from alert_event where resolved_at is null and owner_routine is null) as unrouted,
  (select count(*) from alert_event where resolved_at is null and dispatched_at is not null
     and acknowledged_at is null and dispatched_at < now()-interval '48 hours') as dispatched_unacked_48h,
  (select round(100.0 * count(*) filter (where verified) / nullif(count(*),0), 1)
     from ops_remediation_attempt where attempted_at > now()-interval '7 days') as autofix_success_pct_7d,
  (select count(*) from ops_remediation_attempt where attempted_at > now()-interval '7 days' and not coalesce(verified,false)) as autofix_failures_7d,
  (select count(*) from alert_event where kind='remediation_exhausted' and resolved_at is null) as remediation_exhausted_open,
  (select max(ran_at) from ops_remediation_run) as worker_last_ran,
  (select count(*) filter (where a.last_ran is null or a.last_ran < now()-interval '30 hours')
     from (select o.canonical,
             (select max(h.ran_at) from ops_routine_sentry_heartbeat h
                join ops_routine_heartbeat_alias al on al.emits_as=h.routine where al.canonical=o.canonical) as last_ran
           from (select unnest(incident_known_owners()) as canonical) o) a) as routines_silent,
  (select count(*) from alert_event where kind='alert_flapping' and resolved_at is null) as flapping_open;

-- ── Cron: run the worker every 15 minutes; watch the worker every 30 ─────────────────────────
-- The worker-stale detector gets its OWN cron (not the big roster) so it is scheduled and watched
-- independently of the sweep it would otherwise depend on. The cron scheduler itself is watched by
-- mon_detect_cron_scheduler_frozen / mon_detect_cron_health and the external dead-man switch, so no
-- component is the sole monitor of itself.
select cron.schedule('run-remediation', '*/15 * * * *',
  $$ set statement_timeout to '120s'; select public.run_remediation(); $$);
select cron.schedule('mon-remediation-worker-stale', '13,43 * * * *',
  $$ set statement_timeout to '30s'; select public.mon_detect_remediation_worker_stale(); $$);
