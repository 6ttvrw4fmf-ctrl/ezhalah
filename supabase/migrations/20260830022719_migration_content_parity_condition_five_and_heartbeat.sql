-- Migration content parity: the fifth drift condition, and a heartbeat so it cannot go dark.
-- Routine #7 (Daily Systems Seam Engineer), 2026-08-30.
--
-- THE SEAM. AGENTS.md's migration-drift guard checks four conditions, and every one of them
-- compares an IDENTIFIER: a version, a name, a function signature. None of them ever reads what a
-- migration file SAYS. So a committed file may contain SQL production never executed, or omit SQL
-- production did execute, and the guard stays green -- the version matches, the name matches, drift
-- reads clean. Measured on 2026-08-30: 75 of 269 strict-era files (26%) disagree with the
-- statements production actually ran. Observed consequences, not hypotheticals:
--   * 20260829234156's file carries a `do $do$` block registering mon_detect_ai_telemetry_health in
--     the twice-hourly sweep; the applied statements do not contain it. A detector registration
--     that exists only in git is the dark-detector shape (AGENTS.md: nine dark detectors once read
--     as a clean bill of health).
--   * 20260829172402's file is 2,260 bytes against 24,177 bytes applied.
--   * AGENTS.md's documented repair path -- "recover the missing SQL verbatim from
--     supabase_migrations.schema_migrations.statements" -- assumes the repo is a faithful record of
--     production. Where these disagree, it is not.
--
-- WHAT THIS MIGRATION ADDS (the database half; the comparison itself lives in CI, which is the only
-- side that can see git):
--   1. ops_migration_content_digests() -- the server publishing, per applied migration, a digest of
--      the statements it actually executed. Read-only, anon-executable, exactly like
--      ops_deploy_preflight_checks: the check runs on the public key and needs no secret.
--   2. ops_content_parity_heartbeat -- one row recording each completed check.
--   3. mon_detect_migration_content_parity_stale() -- raises when that heartbeat goes stale, so a
--      barrier that stops running becomes an alert instead of silence. This is the lesson of
--      mon_detect_stalled_daily_detector: a monitor that cannot fire reads as "clean", which is
--      strictly worse than no monitor at all.

-- ── 1. The digests the CI check compares against ──────────────────────────────────────────────
--
-- Deliberately a NEW function rather than another column on ops_deploy_preflight_checks: that RPC
-- gates scripts/safe-deploy.sh, and needle-editing a live deploy gate to add an unrelated read is
-- how a deploy path breaks. Same grants, same security posture, separate blast radius.
--
-- The digest is md5 over the statements joined with newlines -- the exact text
-- `statements` holds. A faithful mirror is byte-identical modulo trailing whitespace (proven on
-- 20260829223530: the file trimmed of its trailing newline hashes to the applied text exactly), so
-- the comparison needs no fuzzy normalisation, and deliberately has none: a looser rule would let a
-- real SQL difference hide behind "probably just formatting".
create or replace function public.ops_migration_content_digests(p_since text default '20260815000000')
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'version', version,
           'name',    name,
           'md5',     left(md5(array_to_string(statements, E'\n')), 10))
         order by version), '[]'::jsonb)
    from supabase_migrations.schema_migrations
   where version > p_since
     and statements is not null;
$function$;

comment on function public.ops_migration_content_digests(text) is
  'Per-migration digest of the statements production actually executed, for the CI content-parity check (drift condition #5). Read-only; anon-executable like ops_deploy_preflight_checks so the check needs no secret.';

grant execute on function public.ops_migration_content_digests(text) to anon, authenticated, service_role;

-- ── 2. The heartbeat ──────────────────────────────────────────────────────────────────────────
create table if not exists public.ops_content_parity_heartbeat (
  id               boolean primary key default true constraint ops_content_parity_heartbeat_one_row check (id),
  checked_at       timestamptz not null default now(),
  divergences      integer     not null,
  baseline_entries integer     not null,
  checker          text        not null
);

comment on table public.ops_content_parity_heartbeat is
  'Single row: the last completed migration content-parity check (scripts/verify-migration-content-parity.ts). Its staleness is what mon_detect_migration_content_parity_stale watches -- a barrier that stops running must alert, not go quiet.';

alter table public.ops_content_parity_heartbeat enable row level security;

-- Readable by anyone (it is ops metadata, no user data); writable only by the service role, which is
-- what the CI workflow holds.
drop policy if exists ops_content_parity_heartbeat_read on public.ops_content_parity_heartbeat;
create policy ops_content_parity_heartbeat_read on public.ops_content_parity_heartbeat
  for select to anon, authenticated using (true);

create or replace function public.ops_record_content_parity_check(
  p_divergences integer, p_baseline_entries integer, p_checker text default 'ci')
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into public.ops_content_parity_heartbeat (id, checked_at, divergences, baseline_entries, checker)
  values (true, now(), p_divergences, p_baseline_entries, p_checker)
  on conflict (id) do update
    set checked_at = excluded.checked_at,
        divergences = excluded.divergences,
        baseline_entries = excluded.baseline_entries,
        checker = excluded.checker;
$function$;

grant execute on function public.ops_record_content_parity_check(integer, integer, text) to service_role;

-- ── 3. The detector that keeps the barrier honest ─────────────────────────────────────────────
--
-- Two branches, and note which severity goes where. A STALE heartbeat is P1: it means the check
-- stopped running, and a check that stopped running is indistinguishable from a check that is
-- passing -- the exact failure this repo has been burned by. Live divergences are P2: they are a
-- real defect but a visible, enumerated one, and the CI job is already red for them.
--
-- Resolve runs on the evaluated path in BOTH directions (spec: resolving from an early return is a
-- worse bug than not resolving at all), so a recovered heartbeat genuinely releases the dedup key
-- and a later recurrence can raise again.
create or replace function public.mon_detect_migration_content_parity_stale()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  hb   public.ops_content_parity_heartbeat%rowtype;
  age  interval;
  n    integer := 0;
begin
  select * into hb from public.ops_content_parity_heartbeat where id;

  -- No heartbeat at all yet is NOT an alert: the barrier ships before its first CI run, and
  -- crying wolf on that would train everyone to ignore it. mon_detect_orphaned_detectors already
  -- guarantees this detector itself is reached.
  if hb.checked_at is null then
    perform public.mon_resolve_key('migration_content_parity', 'migration_content_parity_stale');
    perform public.mon_resolve_key('migration_content_parity', 'migration_content_parity_diverged');
    return 0;
  end if;

  age := now() - hb.checked_at;

  -- The check rides .github/workflows/migration-drift-guard.yml, scheduled every 15 minutes. GitHub
  -- Actions schedules are unreliable enough that a tight bar would be pure noise (measured on
  -- alert-dispatch.yml: 11.7 runs/day against 48 scheduled), so 6h is the bar -- far beyond any
  -- normal scheduling gap, and still same-day.
  if age > interval '6 hours' then
    n := n + public.mon_raise('P1', 'migration_content_parity', null,
      'migration_content_parity_stale',
      jsonb_build_object(
        'why', 'the migration content-parity check (drift condition #5) has not reported in over 6 hours. A barrier that stops running reads exactly like a barrier that is passing.',
        'last_checked_at', hb.checked_at,
        'age_hours', round(extract(epoch from age)/3600.0, 1),
        'first_check', 'Actions > Migration drift guard (production vs git) - is the scheduled job still running and green?'));
  else
    perform public.mon_resolve_key('migration_content_parity', 'migration_content_parity_stale');
  end if;

  if hb.divergences > 0 then
    n := n + public.mon_raise('P2', 'migration_content_parity', null,
      'migration_content_parity_diverged',
      jsonb_build_object(
        'why', 'committed migration file(s) disagree with the statements production actually executed, beyond the enumerated baseline. The repo is not a faithful record of production, and the documented "recover verbatim from schema_migrations.statements" repair path assumes it is.',
        'divergences', hb.divergences,
        'baseline_entries', hb.baseline_entries,
        'checked_at', hb.checked_at,
        'first_check', 'the failing CI job names each file; reconcile the file against schema_migrations.statements, or apply the part production never got.'));
  else
    perform public.mon_resolve_key('migration_content_parity', 'migration_content_parity_diverged');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_migration_content_parity_stale() is
  'Drift condition #5 watchdog: raises P1 if the CI content-parity check goes silent (>6h) and P2 while it reports divergences past the baseline. Registered in mon_run_all_detectors in this same migration.';

-- ── 4. Roster registration, in the SAME migration (AGENTS.md) ─────────────────────────────────
--
-- NEEDLE EDIT off the LIVE definition, never a hand-authored full-body replace: mon_run_all_detectors
-- holds its roster as a hardcoded array, and rewriting it from a stale copy is how a concurrent
-- session's registration gets silently dropped. Idempotent, and it refuses to guess if the anchor
-- is gone rather than appending blind.
do $do$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if def is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_migration_content_parity_stale' in def) > 0 then
    raise notice 'mon_detect_migration_content_parity_stale already registered - no-op'; return;
  end if;
  if position('''mon_detect_orphaned_detectors''' in def) = 0 then
    raise exception 'anchor mon_detect_orphaned_detectors missing - refusing to guess an insert point';
  end if;

  -- Placed beside mon_detect_orphaned_detectors deliberately: both answer "is something that is
  -- supposed to be watching actually watching?".
  def := replace(def,
    '''mon_detect_orphaned_detectors'',',
    '''mon_detect_orphaned_detectors'',' || chr(10) || '    ''mon_detect_migration_content_parity_stale'',');

  execute def;
end
$do$;
