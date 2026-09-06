-- SCOPE-REACHABILITY BARRIER, HARDENED (Search & Matching QA, §19/§26 — 2026-09-04).
--
-- The 2026-08-20 detector judged reachability against ops_qa_scope and trusted that registry
-- absolutely. The registry is a HARVEST, and nothing refreshed it: §41.6 says it is re-harvested
-- from real browser requests each run, but no code ever did, so it sat at its 2026-08-20 hand-built
-- values for fifteen days. Two failures followed, and the detector could see neither:
--
--   FALSE POSITIVE — five platforms (abralosol/arkaan/therc/rawasidark/aouj) shipped in
--   RES_TABLES/COM_TABLES on 2026-09-03. Production reaches them; the registry had never heard of
--   them; the detector raised TEN P1s claiming 4,320 production-ready listings were "stored,
--   indexed and invisible". Verified false against the served bundle the same day.
--
--   FALSE NEGATIVE, the dangerous half — had the client DROPPED a table, the stale registry would
--   still have listed it and this detector would have reported it reachable. The one bug class it
--   exists to catch would have passed straight through it.
--
-- Neither is fixed by re-harvesting once: that only resets the clock. What was missing is that the
-- detector had no notion of how OLD its evidence was, so it made equally confident claims from
-- fifteen-day-old data as from fresh. It now distinguishes the three cases it was conflating:
--
--   registry EMPTY  → P2, cannot judge (unchanged).
--   registry STALE  → P2 naming the age, and it explicitly WITHDRAWS any standing unreachable
--                     claim: a confident P1 resting on evidence we no longer trust is worse than
--                     no claim at all, in both directions.
--   registry FRESH  → judge, and SELF-HEAL — resolve any open per-table claim that no longer
--                     qualifies. The old body never resolved these, so today's ten false P1s would
--                     have stayed open forever even after the registry was corrected. That is the
--                     failure AGENTS.md already names: an all-zero detector sweep sitting on top of
--                     open alerts reads as a clean bill of health.
--
-- Freshness is kept by e2e/qa-coverage/harvest-scope.mjs, which drives one real production search
-- per scope label and reads p_tables out of the intercepted request. If that harvester ever stops
-- running, this detector goes P2-loud within STALE_AFTER rather than silently blind.
create or replace function public.mon_detect_search_scope_unreachable_inventory()
returns int language plpgsql as $$
declare
  v_n int := 0; r record;
  v_age interval;
  -- The harvester runs with the daily QA routine, so three days tolerates a couple of missed runs
  -- without tolerating drift of the kind that produced the 2026-09-04 false alarms.
  c_stale_after constant interval := interval '3 days';
begin
  -- Guard: an empty registry must not read as "everything is reachable".
  if (select count(*) from public.ops_qa_scope) = 0 then
    return public.mon_raise('P2', 'search_scope_unreachable', null,
      'search_scope_registry_empty',
      jsonb_build_object('why', 'The harvested client table-scope registry (ops_qa_scope) is empty, so unreachable-inventory cannot be judged.',
                         'fix', 'Re-harvest it: node e2e/qa-coverage/harvest-scope.mjs — docs/ops/SEARCH_MATCH_QA_ENGINEER.md §39.1'));
  end if;
  perform public.mon_resolve_key('search_scope_unreachable', 'search_scope_registry_empty');

  -- The OLDEST label decides: one label left behind is enough to mis-judge the tables it covers.
  select now() - min(q.harvested_at) into v_age from public.ops_qa_scope q;

  if v_age is null or v_age > c_stale_after then
    -- Withdraw every standing per-table claim. They were derived from evidence now known to be
    -- untrustworthy; leaving them open would keep asserting a fact this detector can no longer
    -- support, which is exactly how the ten false P1s of 2026-09-04 would have outlived their fix.
    for r in
      select a.dedup_key from public.alert_event a
       where a.kind = 'search_scope_unreachable'
         and a.resolved_at is null
         and a.dedup_key like 'search\_scope\_unreachable:%'
    loop
      perform public.mon_resolve_key('search_scope_unreachable', r.dedup_key);
    end loop;
    return public.mon_raise('P2', 'search_scope_unreachable', null,
      'search_scope_registry_stale',
      jsonb_build_object(
        'why', format('The client table-scope registry was last harvested %s ago (limit %s), so reachability cannot be judged. A stale registry fails BOTH ways: it invents unreachable tables the client actually sends, and it hides a table the client has genuinely dropped.', coalesce(v_age::text, 'never'), c_stale_after),
        'fix', 'Re-harvest from real production requests: node e2e/qa-coverage/harvest-scope.mjs'));
  end if;
  perform public.mon_resolve_key('search_scope_unreachable', 'search_scope_registry_stale');

  -- Evidence is fresh — judge it.
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
        'fix', 'Either the client scope lost the table or ops_qa_scope is stale; re-harvest (node e2e/qa-coverage/harvest-scope.mjs) before concluding.'));
  end loop;

  -- SELF-HEAL: any open per-table claim whose table is reachable again is resolved here. Without
  -- this the detector can only ever accumulate; a corrected registry never cleared the alarm.
  for r in
    select a.dedup_key from public.alert_event a
     where a.kind = 'search_scope_unreachable'
       and a.resolved_at is null
       and a.dedup_key like 'search\_scope\_unreachable:%'
       and not exists (
         select 1 from public.search_listings_ar s
          where s.production_ready
            and s.source_table = substring(a.dedup_key from length('search_scope_unreachable:') + 1)
            and not exists (select 1 from public.ops_qa_scope q where s.source_table = any(q.tables)))
  loop
    perform public.mon_resolve_key('search_scope_unreachable', r.dedup_key);
  end loop;

  return v_n;
end $$;
