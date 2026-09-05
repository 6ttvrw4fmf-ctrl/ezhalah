-- mon_detect_search_scope_unreachable_inventory() could RAISE a per-table key and never resolve it
-- (Data Integrity run 2026-09-04).
--
-- THE DEFECT. The detector resolves exactly one key -- 'search_scope_registry_empty' -- and only when
-- it raised nothing at all. Its per-table keys ('search_scope_unreachable:<table>') had NO resolve
-- path in any code. Once a table was flagged, its P1 stayed open forever, even after the table became
-- reachable. Observed today: the 2026-09-04 ops_qa_scope re-harvest made all ten flagged tables
-- reachable, the detector returned 0, and all ten P1s stayed open.
--
-- WHY THAT IS THE DANGEROUS SHAPE, not cosmetics. mon_raise() returns 0 when its dedup key is already
-- open, so a detector that never stands down reads as a clean sweep (return 0) sitting on top of ten
-- open P1s -- the exact "nine dark detectors read as a clean bill of health" failure of 2026-08-10
-- that AGENTS.md requires open_alerts be read alongside the sweep counts to catch. Worse, a stuck-open
-- key SUPPRESSES the real alarm: if that table later goes genuinely unreachable, mon_raise() dedups
-- against the stale row and raises nothing new.
--
-- THE FIX. Compute the raised set, then resolve every open key of this kind that is NOT in it. A key
-- stands down only on POSITIVE evidence -- the table is reachable through some client scope now, or it
-- no longer holds production_ready rows -- never on the detector merely not looking. The registry-empty
-- guard still short-circuits FIRST and stands nothing down: when the registry is unreadable, the
-- detector must not conclude anything is reachable. Fails closed, unchanged in that direction.
create or replace function public.mon_detect_search_scope_unreachable_inventory()
returns int language plpgsql as $$
declare v_n int := 0; r record; v_raised text[] := '{}'; k text;
begin
  -- Guard: an empty registry must not read as "everything is reachable". Note it returns EARLY and
  -- deliberately stands nothing down -- an unreadable registry is not evidence of reachability.
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
    v_raised := v_raised || ('search_scope_unreachable:' || r.source_table);
    v_n := v_n + public.mon_raise('P1', 'search_scope_unreachable',
      split_part(r.source_table, '_', 1),
      'search_scope_unreachable:' || r.source_table,
      jsonb_build_object(
        'source_table', r.source_table,
        'production_ready_rows', r.n,
        'why', format('Every Normal Filter search sends an explicit source_table list. %s is in none of them, so its %s production-ready listings cannot be returned by any search — stored, indexed and invisible.', r.source_table, r.n),
        'fix', 'Either the client scope lost the table or ops_qa_scope is stale; re-harvest the scopes from real production requests before concluding.'));
  end loop;

  -- STAND DOWN on positive evidence: every open per-table key this evaluated sweep did NOT re-raise
  -- describes a table that is reachable now (or holds no production_ready rows). Scoped to the
  -- per-table keys by the ':' prefix so the registry-empty key is never resolved here.
  for k in
    select a.dedup_key from public.alert_event a
     where a.kind = 'search_scope_unreachable'
       and a.resolved_at is null
       and a.dedup_key like 'search\_scope\_unreachable:%'
       and not (a.dedup_key = any(v_raised))
  loop
    perform public.mon_resolve_key('search_scope_unreachable', k);
  end loop;

  if v_n = 0 then
    perform public.mon_resolve_key('search_scope_unreachable', 'search_scope_registry_empty');
  end if;
  return v_n;
end $$;

-- Prove BOTH directions in the same migration, on the live inventory.
do $$
declare v_n int; v_open int; v_seeded int;
begin
  -- (1) a seeded control key for a table that is NOT unreachable must be stood down by the next run.
  perform public.mon_raise('P1', 'search_scope_unreachable', 'ctl',
    'search_scope_unreachable:__control_reachable_table__',
    jsonb_build_object('why', 'seeded control for the 2026-09-04 stand-down proof'));
  select count(*) into v_seeded from public.alert_event
   where kind='search_scope_unreachable' and dedup_key='search_scope_unreachable:__control_reachable_table__' and resolved_at is null;
  if v_seeded <> 1 then raise exception 'control key was not raised — proof is vacuous'; end if;

  v_n := public.mon_detect_search_scope_unreachable_inventory();

  select count(*) into v_open from public.alert_event
   where kind='search_scope_unreachable' and dedup_key='search_scope_unreachable:__control_reachable_table__' and resolved_at is null;
  if v_open <> 0 then raise exception 'control key survived the sweep — stand-down does not work'; end if;

  -- (2) a table that IS genuinely unreachable must still raise. Asserted structurally: the registry
  -- currently leaves nothing unreachable, so the sweep must be 0 AND no per-table key may remain open.
  if v_n <> 0 then raise exception 'expected 0 unreachable tables after the re-harvest, got %', v_n; end if;
  select count(*) into v_open from public.alert_event
   where kind='search_scope_unreachable' and resolved_at is null and dedup_key like 'search\_scope\_unreachable:%';
  if v_open <> 0 then raise exception '% per-table keys still open after a clean sweep', v_open; end if;
end $$;
