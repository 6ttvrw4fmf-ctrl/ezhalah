-- A REBUILD MUST NEVER SILENTLY REVERT WHAT PRODUCTION IS ALREADY DOING.
--
-- rebuild_af_filter_rpcs() is the SANCTIONED path for the four AF shared-eligibility RPCs — the P0
-- rail says never hand-edit them, always go through af_eligibility_clause() + rebuild. On 2026-09-04
-- that rail was a loaded gun pointed at production:
--
--   * all four live RPCs carry `price_total_effective` (the per-m² × area derived total, owner rule
--     2026-09-03, which made 2,640 per-m²-only sale listings budget-searchable),
--   * af_eligibility_clause() does NOT carry it, and neither does any af_rpc_templates row,
--   * the clause no longer appears verbatim in ANY of the four (position() = 0 on all four).
--
-- So the next engineer who correctly followed the rail would have dropped and recreated all four
-- from a STALE definition, silently un-searchabling those listings — and then rebuild_af_filter_rpcs()
-- would have written the reverted md5 into af_rpc_build_state, so mon_af_predicate_parity() would
-- have gone GREEN on the regression. A guard that blesses the revert is worse than no guard.
--
-- The predicate is DERIVED FROM THE CATALOG, never a hand-kept list of "important" tokens: any
-- column of search_listings_ar that the LIVE function references and the RENDERED template does not
-- is a semantic the rebuild would drop. Measured on install day it names exactly one column on
-- exactly the four functions — no false positives.
--
-- It fails CLOSED and BEFORE any DDL: the check runs ahead of the drop loop, so a refusal leaves
-- production untouched. It is not a lock on the rail — it is satisfied the moment the clause and the
-- templates are brought up to what production actually runs, which is the real repair.

create or replace function public.af_rebuild_would_revert()
returns table(o_fn_name text, o_dropped text[])
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with cols as (
    -- >= 6 chars: short attribute names ('id', 'city') appear inside unrelated identifiers and would
    -- make this noisy. Every semantic column this guard exists for is far longer.
    select a.attname::text as c
      from pg_attribute a
     where a.attrelid = 'public.search_listings_ar'::regclass
       and a.attnum > 0
       and not a.attisdropped
       and length(a.attname::text) >= 6
  ),
  fns as (
    select t.fn_name,
           pg_get_functiondef(p.oid) as live,
           replace(t.template, '__AF_ELIGIBILITY_WHERE__', public.af_eligibility_clause()) as rendered
      from public.af_rpc_templates t
      join pg_proc p on p.proname = t.fn_name and p.prokind = 'f'
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  )
  select f.fn_name, array_agg(c.c order by c.c)
    from fns f
    join cols c on position(c.c in f.live) > 0 and position(c.c in f.rendered) = 0
   group by f.fn_name;
$fn$;

grant execute on function public.af_rebuild_would_revert() to service_role;

-- ── the pre-flight, needle-edited into the LIVE rebuild body (never retyped) ─────────────────────
do $mig$
declare
  src text := pg_get_functiondef('public.rebuild_af_filter_rpcs'::regproc);
  a1  text := 'declare t record; r record; new_md5 text; n int;';
  a2  text := E'begin\n  for t in select * from public.af_rpc_templates';
  guard text;
begin
  if (length(src) - length(replace(src, a1, ''))) / length(a1) <> 1 then
    raise exception 'declare anchor not found exactly once in rebuild_af_filter_rpcs()';
  end if;
  if (length(src) - length(replace(src, a2, ''))) / length(a2) <> 1 then
    raise exception 'begin anchor not found exactly once in rebuild_af_filter_rpcs()';
  end if;
  if position('af_rebuild_would_revert' in src) > 0 then
    raise exception 'rebuild_af_filter_rpcs() already carries the guard — refusing to double-apply';
  end if;

  guard := E'begin\n'
    || E'  -- FAIL CLOSED, BEFORE ANY DDL. A rebuild renders the templates from af_eligibility_clause();\n'
    || E'  -- if that rendering references FEWER search_listings_ar columns than the function running in\n'
    || E'  -- production, this rebuild would delete behaviour nobody asked it to delete, and would then\n'
    || E'  -- record the reverted definition as the correct build state. Bring the clause/templates up to\n'
    || E'  -- what production runs first; this check passes the moment they agree.\n'
    || E'  select string_agg(format(''%s would lose [%s]'', w.o_fn_name, array_to_string(w.o_dropped, '', '')), ''; '' order by w.o_fn_name)\n'
    || E'    into v_bad from public.af_rebuild_would_revert() w;\n'
    || E'  if v_bad is not null then\n'
    || E'    raise exception ''rebuild refused: it would DROP semantics the live functions carry — %. %'',\n'
    || E'      v_bad,\n'
    || E'      ''Update af_eligibility_clause() / af_rpc_templates to carry them FIRST, then rebuild. ''\n'
    || E'      ''Rebuilding now would silently revert shipped behaviour and stamp the reverted ''\n'
    || E'      ''definition into af_rpc_build_state, turning the parity barrier green on the regression.'';\n'
    || E'  end if;\n'
    || E'\n'
    || E'  for t in select * from public.af_rpc_templates';

  src := replace(src, a1, 'declare t record; r record; new_md5 text; n int; v_bad text;');
  src := replace(src, a2, guard);
  execute src;
end
$mig$;

-- ── the detector, so the danger is visible on the dashboard and not only at rebuild time ─────────
create or replace function public.mon_detect_af_rebuild_would_revert()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare bad jsonb := '[]'::jsonb; n int := 0; w record;
begin
  for w in select * from public.af_rebuild_would_revert() order by o_fn_name loop
    bad := bad || jsonb_build_object(
      'fn', w.o_fn_name,
      'columns_the_rebuild_would_drop', to_jsonb(w.o_dropped),
      'why', 'This function runs in production referencing these search_listings_ar columns, but '
          || 'rendering its af_rpc_templates row through af_eligibility_clause() does not. The '
          || 'sanctioned rebuild would therefore REVERT live behaviour.');
  end loop;

  if jsonb_array_length(bad) > 0 then
    n := public.mon_raise('P1', 'af_rebuild_would_revert', 'search_index', 'af_rebuild_would_revert',
      jsonb_build_object('failures', bad,
        'why', 'The single definition of AF eligibility has fallen BEHIND the four RPCs that are '
            || 'supposed to be generated from it. The rail is not merely out of sync — following it '
            || 'would destroy shipped behaviour, and rebuild_af_filter_rpcs() would then record the '
            || 'reverted definition as correct, so mon_af_predicate_parity() would read green.',
        'do_not', 'Do NOT run rebuild_af_filter_rpcs() to clear this (it is now refused anyway), and '
            || 'do NOT hand-edit the live functions further. Port the missing semantics INTO '
            || 'af_eligibility_clause() / af_rpc_templates, then rebuild, then verify the four RPCs '
            || 'still return the same counts they do today.'));
  else
    perform public.mon_resolve_key('af_rebuild_would_revert', 'af_rebuild_would_revert');
  end if;
  return n;
end
$fn$;

-- ── roster entry, in the SAME migration (a detector nothing reaches is decoration) ───────────────
do $mig$
declare
  src text := pg_get_functiondef('public.mon_run_all_detectors'::regproc);
  anchor text := E'''mon_detect_af_count_surfaces_carry_af'',';
begin
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'roster anchor not found exactly once in mon_run_all_detectors()';
  end if;
  if position('mon_detect_af_rebuild_would_revert' in src) > 0 then
    raise exception 'mon_run_all_detectors() already lists the detector — refusing to double-apply';
  end if;
  execute replace(src, anchor, anchor || E'\n    ''mon_detect_af_rebuild_would_revert'',');
end
$mig$;

-- ── self-assertions: prove BOTH directions before this migration is allowed to commit ────────────
do $mig$
declare v_rows int; v_cols text[]; v_refused boolean := false; v_listed boolean;
begin
  -- (1) the guard must be COMPILED INTO the rebuild, and it must sit ahead of the drop loop. This is
  --     asserted BEFORE the rebuild is ever invoked below, so that invocation is safe by
  --     construction: with the guard first and the predicate non-empty, the call cannot reach DDL.
  if position('af_rebuild_would_revert' in pg_get_functiondef('public.rebuild_af_filter_rpcs'::regproc)) = 0 then
    raise exception 'the guard was not compiled into rebuild_af_filter_rpcs()';
  end if;
  if position('af_rebuild_would_revert' in pg_get_functiondef('public.rebuild_af_filter_rpcs'::regproc))
     > position('drop function' in pg_get_functiondef('public.rebuild_af_filter_rpcs'::regproc)) then
    raise exception 'the guard sits AFTER the drop loop — it would refuse a rebuild that already destroyed the functions';
  end if;

  -- (2) the predicate must name exactly what was measured, or it is noisier than believed
  select count(*) into v_rows from public.af_rebuild_would_revert();
  if v_rows <> 4 then
    raise exception 'expected the 4 known-diverged AF RPCs, got % — investigate before installing', v_rows;
  end if;
  select o_dropped into v_cols from public.af_rebuild_would_revert() where o_fn_name = 'af_eligible_count';
  if v_cols is distinct from array['price_total_effective'] then
    raise exception 'expected exactly [price_total_effective], got % — the predicate is noisier than measured', v_cols;
  end if;

  -- (3) EXECUTED proof, not a source claim: the rebuild must now REFUSE rather than revert
  begin
    perform * from public.rebuild_af_filter_rpcs();
  exception when others then
    v_refused := position('rebuild refused' in sqlerrm) > 0;
  end;
  if not v_refused then
    raise exception 'rebuild_af_filter_rpcs() did NOT refuse — the guard is not armed';
  end if;

  -- the detector must be reachable from the roster
  select position('mon_detect_af_rebuild_would_revert' in pg_get_functiondef('public.mon_run_all_detectors'::regproc)) > 0
    into v_listed;
  if not v_listed then raise exception 'detector is not in the mon_run_all_detectors roster'; end if;
end
$mig$;;