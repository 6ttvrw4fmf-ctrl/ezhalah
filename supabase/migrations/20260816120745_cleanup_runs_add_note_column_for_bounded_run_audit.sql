-- Owner-approved 2026-08-16: additive, nullable audit column so a scoped one-time bounded
-- cleanup run (see scrapers/common/cleanup.py `run(..., bounded_cap=...)`) can record WHY its
-- work-set was capped without touching platform_retention_policy or any existing column.
-- Purely additive: existing readers/writers of cleanup_runs are unaffected (NULL by default).
alter table public.cleanup_runs add column if not exists note text;
