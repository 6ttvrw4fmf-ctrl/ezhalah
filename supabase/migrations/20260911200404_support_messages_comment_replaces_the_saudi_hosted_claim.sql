-- Unrelated to this session's amaall fix, but surfaced by it: 20260903034349_support_messages.sql
-- was only recovered into git for the FIRST time today (it had been missing from git entirely,
-- see the migration-drift recovery earlier this session), which is what let
-- verify-no-unsupported-claims.ts see its comment for the first time and fail on it.
--
-- That comment made an incorrect data-residency claim about where the project's Postgres runs.
-- Production is ap-northeast-1 (Tokyo), never the Kingdom (see
-- feedback_residency-claims-are-banned-in-comments-too and src/data/legal.ts). The migration file
-- that already ran is immutable; this corrects the LIVE comment going forward without touching
-- anything else about the table.
comment on table public.support_messages is
  'In-app «تواصل معنا» messages. Service-role only (RLS on, no policies). ip_hash is a salted hash, '
  'never a raw IP. Stored in the project''s own Postgres, hosted in ap-northeast-1 (Tokyo).';
