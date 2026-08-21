-- Drift resolution (2026-08-20): ops_qa_search_differential had TWO live overloads — the intended
-- p_tables text[]-leading one (client-table-scope design) AND a stale p_scope text-leading one left
-- behind when a CREATE OR REPLACE changed the leading arg type (that creates a NEW overload instead
-- of replacing — the exact PGRST203 duplicate-overload hazard the deploy preflight refuses on). This
-- QA/diagnostic function has no app or scripts caller; dropping the stale signature restores it to a
-- single overload. Keep: (text[], text[], text[], text[], text, text, text, text[], text[], int[],
-- int, int, int[], int, numeric, numeric). Drop the (text, text[], text, ...) p_scope form.
drop function if exists public.ops_qa_search_differential(
  text, text[], text, text[], text, text, text, text[], text[], integer[],
  integer, integer, integer[], integer, numeric, numeric);
