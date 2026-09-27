create table if not exists public.ops_remediation_policy (
  kind             text primary key,
  fix_fn           text,
  verify_fn        text not null,
  max_attempts     int  not null default 3,
  cooldown_minutes int  not null default 60,
  enabled          boolean not null default true,
  note             text,
  registered_at    timestamptz not null default now()
);
comment on table public.ops_remediation_policy is
  'Auto-remediation registry. A kind is auto-fixed ONLY if it has a row here with fix_fn set and enabled. fix_fn must be idempotent; verify_fn re-reads production and returns true when the original condition is gone. A row with fix_fn NULL is escalate-only (judgment required).';

create table if not exists public.ops_remediation_attempt (
  id           bigserial primary key,
  kind         text not null,
  dedup_key    text not null,
  platform     text,
  attempted_at timestamptz not null default now(),
  attempt_no   int  not null,
  fix_fn       text,
  fix_ok       boolean,
  verified     boolean,
  error        text
);
create index if not exists ops_remediation_attempt_dedup on public.ops_remediation_attempt (dedup_key, attempted_at desc);

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
     order by ae.severity, ae.created_at
  loop
    v_considered := v_considered + 1;
    if v_attempted >= v_cap then exit; end if;
    select * into pol from public.ops_remediation_policy where kind = a.kind;

    select count(*), max(attempted_at)
      into v_attempts_today, v_last
      from public.ops_remediation_attempt
     where dedup_key = a.dedup_key and attempted_at > now() - interval '24 hours';

    if v_last is not null and v_last > now() - make_interval(mins => pol.cooldown_minutes) then
      continue;
    end if;

    if v_attempts_today >= pol.max_attempts then
      v_escalated := v_escalated + public.mon_raise('P0', 'remediation_exhausted', a.platform,
        'remediation_exhausted:' || a.dedup_key,
        jsonb_build_object('failed_kind', a.kind, 'dedup_key', a.dedup_key, 'platform', a.platform,
          'attempts_24h', v_attempts_today, 'max_attempts', pol.max_attempts,
          'why', 'Auto-fix ran ' || v_attempts_today || ' times in 24h and production still shows the condition. This is no longer a safe automatic fix; a human/owner routine must take it.',
          'action', 'Investigate ' || a.kind || ' for ' || coalesce(a.platform,'(none)') || '; see ops_remediation_attempt for the errors. Resolves automatically once verify passes.'));
      continue;
    end if;

    v_attempt_no := v_attempts_today + 1;
    v_attempted := v_attempted + 1;
    v_fix_ok := false; v_err := null;

    begin
      execute format('select public.%I($1,$2)', pol.fix_fn) using a.dedup_key, a.platform;
      v_fix_ok := true;
    exception when others then
      v_fix_ok := false; v_err := sqlerrm;
    end;

    begin
      execute format('select public.%I($1,$2)', pol.verify_fn) into v_verified using a.dedup_key, a.platform;
    exception when others then
      v_verified := false; v_err := coalesce(v_err,'') || ' verify_error: ' || sqlerrm;
    end;

    insert into public.ops_remediation_attempt(kind, dedup_key, platform, attempt_no, fix_fn, fix_ok, verified, error)
      values (a.kind, a.dedup_key, a.platform, v_attempt_no, pol.fix_fn, v_fix_ok, coalesce(v_verified,false), v_err);

    if coalesce(v_verified, false) then
      perform public.mon_resolve_key(a.kind, a.dedup_key);
      perform public.mon_resolve_key('remediation_exhausted', 'remediation_exhausted:' || a.dedup_key);
      v_fixed := v_fixed + 1;
    elsif v_attempt_no >= pol.max_attempts then
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
        'why', 'run_remediation() has not recorded a sweep in over 2h. Auto-fixing is dark: detected problems with safe fixes are no longer being repaired. Detection and escalation still run, but the self-healing half is down.',
        'action', 'Check the run-remediation cron and mon_config.remediation_enabled.'));
  else
    perform public.mon_resolve_key('remediation_worker_stale', 'remediation_worker_stale');
  end if;
  return n;
end $fn$;

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

select cron.schedule('run-remediation', '*/15 * * * *',
  $$ set statement_timeout to '120s'; select public.run_remediation(); $$);
select cron.schedule('mon-remediation-worker-stale', '13,43 * * * *',
  $$ set statement_timeout to '30s'; select public.mon_detect_remediation_worker_stale(); $$);