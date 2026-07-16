-- ─────────────────────────────────────────────────────────────────────────────────────────
-- PRODUCTION DEPLOY LOCK — prevent two concurrent Claude sessions (or two humans) from
-- deploying / changing the Vercel production alias at the same time.
--
-- WHY (2026-07-15 incident, project aannarbkwcymrotzwdbo / repo 6ttvrw4fmf-ctrl/ezhalah): during
-- a single P0 remediation window, TWO separate concurrent sessions independently ran
-- production-affecting Vercel actions with no coordination — one merged+deployed PR #78 without
-- approval, and while a second session was mid-revert on `main`, a THIRD session deployed `main`
-- directly (still containing the unremoved bug at that moment), re-breaking production live a
-- second time. `scripts/safe-deploy.sh` guards against deploying a dirty/stale local tree, but
-- has no concept of "is another session deploying right now" — two sessions can each pass its
-- checks and both call `vercel --prod`/`vercel rollback` seconds apart. See
-- project memory `pr78-outage-rollback-2026-07-15` for the full incident.
--
-- DESIGN: a single-row-per-lock-name table + two SECURITY DEFINER functions that do an atomic
-- "acquire if free or expired" / "release only if you're the holder" — race-safe because the
-- whole acquire check-and-set happens in ONE statement, not a separate SELECT-then-INSERT.
-- Self-expiring (short TTL) so a crashed/killed session can never permanently block deploys —
-- the tradeoff is a future deploy may have to wait out a stale lock's TTL (minutes, not hours).
--
-- Service-role only (RLS enabled, zero policies — anon/authenticated get nothing). Callable via:
--   - Any Claude/MCP session: `select * from acquire_deploy_lock('production', '<holder>', 600, '<note>');`
--   - `scripts/deploy-lock.sh` (curl + SUPABASE_SERVICE_ROLE_KEY, calls the same RPCs via PostgREST)
-- ─────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.ops_deploy_lock (
  lock_name   text primary key,
  holder      text not null,
  acquired_at timestamptz not null default now(),
  expires_at  timestamptz not null,
  note        text
);

comment on table public.ops_deploy_lock is
  'Mutual-exclusion lock for production Vercel deploys/rollbacks/alias changes. Acquire via '
  'acquire_deploy_lock() before ANY vercel --prod, vercel rollback, or Vercel-alias-changing '
  'MCP tool call; release via release_deploy_lock() immediately after. See '
  'docs/DEPLOY_SAFETY.md and AGENTS.md.';

alter table public.ops_deploy_lock enable row level security;
-- Deliberately zero policies: PostgREST/anon/authenticated get no access at all. Only
-- service_role (which bypasses RLS) or a SECURITY DEFINER function (below) can touch this table.
revoke all on public.ops_deploy_lock from anon, authenticated;

-- Atomic acquire: succeeds (returns the row) if the lock is free, doesn't exist yet, or has
-- expired; fails (returns zero rows) if genuinely held by someone else right now. The
-- INSERT .. ON CONFLICT .. DO UPDATE .. WHERE makes this a single atomic statement — no
-- check-then-act race between two concurrent callers.
create or replace function public.acquire_deploy_lock(
  p_lock_name text,
  p_holder text,
  p_ttl_seconds int default 600,
  p_note text default null
) returns table (lock_name text, holder text, acquired_at timestamptz, expires_at timestamptz)
language sql
security definer
set search_path = public
as $$
  insert into ops_deploy_lock as l (lock_name, holder, acquired_at, expires_at, note)
  values (p_lock_name, p_holder, now(), now() + make_interval(secs => p_ttl_seconds), p_note)
  on conflict (lock_name) do update
    set holder = excluded.holder,
        acquired_at = excluded.acquired_at,
        expires_at = excluded.expires_at,
        note = excluded.note
    where l.expires_at < now()
  returning l.lock_name, l.holder, l.acquired_at, l.expires_at;
$$;

comment on function public.acquire_deploy_lock(text, text, int, text) is
  'Atomically acquire the named deploy lock. Returns one row on success (you hold it until '
  'expires_at); returns ZERO rows if someone else holds it and it has not expired — in that '
  'case DO NOT deploy, report the existing holder to the user instead. Default TTL 600s (10min).';

-- Release: only the actual holder can release (prevents a slow/stale caller from releasing a
-- lock someone else has since legitimately acquired after this caller's TTL expired).
create or replace function public.release_deploy_lock(
  p_lock_name text,
  p_holder text
) returns boolean
language sql
security definer
set search_path = public
as $$
  with d as (
    delete from ops_deploy_lock
    where lock_name = p_lock_name and holder = p_holder
    returning 1
  )
  select exists(select 1 from d);
$$;

comment on function public.release_deploy_lock(text, text) is
  'Release the named deploy lock. Only succeeds if p_holder matches the current holder (a '
  'no-op — returns false — if your lock already expired and someone else acquired it).';

-- No EXECUTE grant to anon/authenticated: SECURITY DEFINER functions are PUBLIC-executable by
-- default in Postgres, so explicitly lock these down the same way as the table.
revoke all on function public.acquire_deploy_lock(text, text, int, text) from public;
revoke all on function public.release_deploy_lock(text, text) from public;
grant execute on function public.acquire_deploy_lock(text, text, int, text) to service_role;
grant execute on function public.release_deploy_lock(text, text) to service_role;
