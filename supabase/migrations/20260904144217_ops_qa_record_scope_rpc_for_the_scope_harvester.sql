-- THE SCOPE HARVESTER'S WRITE PATH (Search & Matching QA, 2026-09-04).
--
-- ops_qa_scope is the ground truth three layers reason from: mon_detect_search_scope_unreachable_
-- inventory judges reachability against it, and ops_qa_cohort_catalog() joins it to build every
-- p_tables the daily coverage layer and the narrowing probe send. It is a HARVEST of what the real
-- client sends, and until today nothing refreshed it — it drifted fifteen days and produced ten
-- false P1s while hiding 4,320 rows from this routine's own coverage.
--
-- e2e/qa-coverage/harvest-scope.mjs now refreshes it from real production searches. That harness
-- runs in the live sweep workflow, which is deliberately ANON-ONLY ("verify via the anon key, never
-- the service role" — live-search-sweep.yml). So the harvester writes the same way the sweep already
-- records coverage: through a SECURITY DEFINER RPC, not by handing a browser-driving job a service
-- role key. This mirrors ops_qa_record_coverage exactly, including its grants.
--
-- The RPC is deliberately narrow: it upserts ONE label and REFUSES an empty table list. An empty
-- ops_qa_scope reads as "everything is reachable" to the detector, so a half-failed harvest must
-- never be able to blank a label — the harness refuses a partial harvest, and this refuses an empty
-- one, so neither layer alone can blind the barrier.
create or replace function public.ops_qa_record_scope(p_scope text, p_tables text[], p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if p_scope is null or btrim(p_scope) = '' then
    raise exception 'ops_qa_record_scope: scope is required';
  end if;
  if p_tables is null or cardinality(p_tables) = 0 then
    raise exception 'ops_qa_record_scope: refusing to record an EMPTY table list for scope % — an empty registry reads as "everything is reachable"', p_scope;
  end if;
  insert into public.ops_qa_scope (scope, tables, harvested_at, note)
  values (p_scope, p_tables, now(),
          coalesce(p_note, 'harvested from a real production browser search — e2e/qa-coverage/harvest-scope.mjs'))
  on conflict (scope) do update
    set tables = excluded.tables, harvested_at = excluded.harvested_at, note = excluded.note;
end $$;

grant execute on function public.ops_qa_record_scope(text, text[], text) to anon, authenticated, service_role;
