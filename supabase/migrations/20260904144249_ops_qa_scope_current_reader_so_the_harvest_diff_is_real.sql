-- THE HARVESTER'S READ PATH (Search & Matching QA, 2026-09-04).
--
-- RLS hides ops_qa_scope from anon, and a hidden table reads as `[]` rather than as an error. The
-- scope harvester compares what production NOW sends against what the registry holds; with an
-- unreadable "current" every label diffs as "+N -0" and a table the client has DROPPED can never be
-- reported. That is the fail-silent direction of the same bug the freshness hardening closes, so the
-- harvester must be able to see the registry it is about to overwrite.
--
-- Read-only, and it exposes nothing a search request does not already carry: p_tables IS this list,
-- sent by every client on every search.
create or replace function public.ops_qa_scope_current()
returns table(scope text, tables text[], harvested_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select q.scope, q.tables, q.harvested_at from public.ops_qa_scope q order by q.scope
$$;

grant execute on function public.ops_qa_scope_current() to anon, authenticated, service_role;
