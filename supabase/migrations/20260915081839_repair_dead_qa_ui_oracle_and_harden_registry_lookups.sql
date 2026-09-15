-- ops_incident #254. Two defects in the QA oracle layer, one repair.
--
-- 1. DEAD SINCE 2026-08-21. 20260820083341 gave ops_qa_search_differential a scope-LABEL overload
--    (text p_scope, ...) that resolved the label through ops_qa_scope_tables(); ops_qa_search_-
--    differential_ui() called it. 20260821025711 dropped that overload to clear the PGRST203
--    duplicate-overload hazard — correctly — but a SQL-language body is not dependency-checked, so
--    the wrapper kept its catalog entry and failed at STARTUP on every call for 24 days.
--    The repair does exactly what the dropped overload did, so no scope->table mapping is invented
--    here: ops_qa_scope / ops_qa_scope_tables hold the HARVESTED truth (§39.1) and ops_qa_diff()
--    already resolves its scopes the same way.
--
-- 2. A LOOKUP MISS RENDERED AS AN ANSWER. Both registry helpers returned NULL for a token with no
--    row, and NULL flows on to mean two different permissive things inside the differential:
--      - p_tables NULL  -> `source_table = any(NULL)` -> 0 rows: the oracle reports the product
--        lost EVERY listing. That is the harness trap §41.15/16/18 shape, but raised by our own
--        registry rather than by a bad scope string — and it is live-reachable, because
--        ops_qa_scope lags the client whenever the harvester has not run (ops_incident #258).
--      - p_types NULL   -> no type restriction at all -> the oracle answers a DIFFERENT, broader
--        question than the one asked and calls it a match.
--    Both are "unknown rendered as a confident answer", the exact class AGENTS.md locks down as
--    SOURCE IS TRUTH — silent->NULL, never unknown->NO. An oracle must refuse a question it did
--    not understand: an unknown token is now an ERROR. A NULL argument still means "not asked" and
--    returns NULL, because both call sites guard NULL explicitly before calling.

create or replace function public.ops_qa_scope_tables(p_scope text)
returns text[] language plpgsql stable set search_path to 'public' as $function$
declare v text[];
begin
  if p_scope is null then return null; end if;          -- "not asked" — callers guard this
  select s.tables into v from public.ops_qa_scope s where s.scope = p_scope;
  if v is null then
    raise exception 'ops_qa_scope has no scope token %', p_scope
      using errcode = 'no_data_found',
            hint = 'Refresh the harvest (e2e/qa-coverage/harvest-scope.mjs) or fix the token. An '
                || 'unknown token must never resolve to an empty table set: the differential would '
                || 'then answer 0 for every search and read as production losing every row.';
  end if;
  return v;
end $function$;

create or replace function public.ops_qa_cohort_types(p_ui_type text)
returns text[] language plpgsql stable set search_path to 'public' as $function$
declare v text[]; v_found boolean := false;
begin
  if p_ui_type is null then return null; end if;        -- "not asked" — callers guard this
  select true, c.types_ar into v_found, v from public.ops_qa_cohort c where c.ui_type = p_ui_type;
  if not coalesce(v_found, false) then
    raise exception 'ops_qa_cohort has no ui_type %', p_ui_type
      using errcode = 'no_data_found',
            hint = 'Refresh the harvest (e2e/qa-coverage/harvest-scope.mjs). An unknown نوع must '
                || 'never resolve to NULL types: the differential reads NULL as "no type '
                || 'restriction" and would silently answer the whole macro cohort instead.';
  end if;
  return v;
end $function$;

create or replace function public.ops_qa_search_differential_ui(
  p_ui_type    text,
  p_scope      text,
  p_scope2     text     default null,
  p_deal       text     default null,
  p_period     text     default null,
  p_cities     text[]   default null,
  p_districts  text[]   default null,
  p_region_ids int[]    default null,
  p_amin       int      default null,
  p_amax       int      default null,
  p_beds       int[]    default null,
  p_bmin       int      default null,
  p_pmin       numeric  default null,
  p_pmax       numeric  default null
) returns table(n bigint, h text)
language plpgsql stable set search_path to 'public' as $function$
declare v_macro text; v_types text[]; v_found boolean := false;
begin
  -- Resolve the cohort ONCE (the old body queried ops_qa_cohort twice, once for types and once for
  -- macro, so the two halves could in principle disagree) and refuse an unrecognised نوع outright.
  select true, c.macro, c.types_ar into v_found, v_macro, v_types
    from public.ops_qa_cohort c where c.ui_type = p_ui_type;
  if not coalesce(v_found, false) then
    raise exception 'ops_qa_cohort has no ui_type %', coalesce(p_ui_type, '<null>')
      using errcode = 'no_data_found',
            hint = 'Pass a نوع from ops_qa_cohort_catalog(). Answering an unrecognised نوع with an '
                || 'unrestricted search would be a confidently-wrong oracle.';
  end if;
  if p_scope is null then
    raise exception 'ops_qa_search_differential_ui requires p_scope (a token from ops_qa_scope)'
      using errcode = 'null_value_not_allowed',
            hint = 'A NULL scope resolves to a NULL table set, which matches nothing and would '
                || 'report 0 for every search.';
  end if;

  return query
  select d.n, d.h from public.ops_qa_search_differential(
    public.ops_qa_scope_tables(p_scope), v_types,
    case when p_scope2 is null then null else public.ops_qa_scope_tables(p_scope2) end,
    case when p_scope2 is null then null else v_types end,
    p_deal, p_period, v_macro, p_cities, p_districts, p_region_ids,
    p_amin, p_amax, p_beds, p_bmin, p_pmin, p_pmax) d;
end $function$;

comment on function public.ops_qa_search_differential_ui(text,text,text,text,text,text[],text[],int[],int,int,int[],int,numeric,numeric) is
  'Scope-label entry point to the §40.5 differential oracle. Repaired 2026-09-15 (ops_incident #254) '
  'after 20260821025711 dropped the scope-label overload it called. Prefer ops_qa_diff(), which '
  'derives the scope from ops_qa_cohort including the monthly overlay; this wrapper is for callers '
  'that need to state the harvested scope explicitly.';
