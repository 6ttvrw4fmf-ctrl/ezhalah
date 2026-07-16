-- ─────────────────────────────────────────────────────────────────────────────────────────
-- DEPLOY LOCK: secret-free status RPC for the MCP-held-lock mode (2026-07-16).
--
-- WHY: scripts/deploy-lock.sh needs SUPABASE_SERVICE_ROLE_KEY, which is deliberately never
-- committed and is not present in Vercel env or any checkout — so a Claude/MCP session (the
-- primary operator of this repo) could hold the deploy lock via the Supabase MCP tool exactly
-- as AGENTS.md prescribes, yet scripts/safe-deploy.sh would still fail closed at its own
-- deploy-lock.sh acquire step for want of the key. deploy-lock.sh's own header already
-- documents the intent: "A Claude/MCP session does NOT need this script at all: it can call
-- the same two RPCs directly via the Supabase MCP tool."
--
-- THIS RPC closes the gap WITHOUT weakening anything: it exposes ONLY the lock's public
-- metadata (holder label, timestamps, expiry state — no secrets; holder strings are session
-- labels like 'claude-session-batch4-deploy'), so safe-deploy.sh can VERIFY — with the same
-- client-public anon key its smoke test already uses — that the caller-claimed MCP holder
-- really does hold an unexpired lock right now. A deploy still cannot proceed unlocked:
-- the new mode fails closed on a missing/mismatched/expired lock or any transport error.
--
-- The table itself stays service-role-only (RLS, no policies) — this SECURITY DEFINER
-- function is the single, read-only, deliberately-public window into it.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.ops_deploy_lock_status()
returns table (
  lock_name   text,
  holder      text,
  acquired_at timestamptz,
  expires_at  timestamptz,
  expired     boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select l.lock_name, l.holder, l.acquired_at, l.expires_at, (l.expires_at < now()) as expired
  from public.ops_deploy_lock l;
$$;

revoke all on function public.ops_deploy_lock_status() from public;
grant execute on function public.ops_deploy_lock_status() to anon, authenticated, service_role;
