-- Clean-slate prep (owner brief 2026-08-16): snapshot agent_notes BEFORE any deactivation.
-- The table itself is NOT dropped and rows are NOT deleted — see the companion disconnect step.
-- Dependency proof at snapshot time: no functions, views, cron jobs, triggers, FKs or RLS
-- policies reference agent_notes; the sole reader was supabase/functions/agent/index.ts.
create table if not exists public.ops_agent_notes_backup_20260816 as
  select *, now() as snapshotted_at from public.agent_notes;

comment on table public.ops_agent_notes_backup_20260816 is
  'Immutable snapshot of agent_notes taken 2026-08-16 before the AI-Agent clean-slate rebuild. Restore with: update agent_notes a set active = b.active from ops_agent_notes_backup_20260816 b where a.id = b.id;';
