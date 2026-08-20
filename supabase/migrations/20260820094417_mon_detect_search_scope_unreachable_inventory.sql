-- SEARCHABILITY BARRIER (Search & Matching QA, §19/§26 — "new listing unreachable → searchability
-- barrier"). The client reaches search_listings_ar through a FIXED set of source_table scopes
-- (ops_qa_scope, harvested from real production requests). A table that accumulates production_ready
-- rows while appearing in NO client scope is inventory no Normal Filter search can ever return — the
-- listing is stored, indexed, and invisible. That failure is silent today: nothing counts it, and the
-- 2026-08-20 run had to check it by hand. Measured that day: 0 unreachable tables, with
-- gathern (28,977) and aqarmonthly (1,663) reachable only through the monthly scopes BY DESIGN — so
-- the 'resm'/'s1m' scopes are what keeps them out of this alarm, and dropping them would fire it
-- (proven read-only in the same run: excluding the *m scopes yields exactly those two tables).
create or replace function public.mon_detect_search_scope_unreachable_inventory()
returns int language plpgsql as $$
declare v_n int := 0; r record;
begin
  -- Guard: an empty registry must not read as "everything is reachable".
  if (select count(*) from public.ops_qa_scope) = 0 then
    return public.mon_raise('P2', 'search_scope_unreachable', null,
      'search_scope_registry_empty',
      jsonb_build_object('why', 'The harvested client table-scope registry (ops_qa_scope) is empty, so unreachable-inventory cannot be judged.',
                         'fix', 'Re-harvest it from real production requests — docs/ops/SEARCH_MATCH_QA_ENGINEER.md §39.1'));
  end if;
  for r in
    select s.source_table, count(*) n
      from public.search_listings_ar s
     where s.production_ready
       and not exists (select 1 from public.ops_qa_scope q where s.source_table = any(q.tables))
     group by 1
  loop
    v_n := v_n + public.mon_raise('P1', 'search_scope_unreachable',
      split_part(r.source_table, '_', 1),
      'search_scope_unreachable:' || r.source_table,
      jsonb_build_object(
        'source_table', r.source_table,
        'production_ready_rows', r.n,
        'why', format('Every Normal Filter search sends an explicit source_table list. %s is in none of them, so its %s production-ready listings cannot be returned by any search — stored, indexed and invisible.', r.source_table, r.n),
        'fix', 'Either the client scope lost the table or ops_qa_scope is stale; re-harvest the scopes from real production requests before concluding.'));
  end loop;
  if v_n = 0 then
    perform public.mon_resolve_key('search_scope_unreachable', 'search_scope_registry_empty');
  end if;
  return v_n;
end $$;

-- Roster entry, in the SAME migration (mon_detect_orphaned_detectors flags anything the roster cannot
-- reach). GUARDED needle-edit of the LIVE body — never a hand-pasted rebuild, which has silently
-- dropped roster entries three times in this repo.
do $$
declare
  v_def text; v_before text; fn text;
  want text[] := array['mon_detect_search_scope_unreachable_inventory'];
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then
      v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
    end if;
  end loop;
  if v_def = v_before then
    raise notice 'roster already carries the detector — nothing to do';
    return;
  end if;
  execute v_def;
end $$;

-- Prove reachability in the same migration, plus controls that must survive the edit.
do $$
declare
  v_def text; fn text; missing text[] := '{}';
  want text[] := array[
    'mon_detect_search_scope_unreachable_inventory',
    'mon_detect_silent_scraper_death','mon_detect_orphaned_detectors','mon_detect_summary_only_capture'
  ];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster edit lost or failed to add: %', missing;
  end if;
end $$;
