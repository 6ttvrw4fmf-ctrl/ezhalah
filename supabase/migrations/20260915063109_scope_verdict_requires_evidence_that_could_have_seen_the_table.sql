-- A SCOPE VERDICT MAY NOT REST ON EVIDENCE THAT COULD NOT HAVE SEEN THE TABLE.
--
-- ops_qa_scope is a HARVEST — a snapshot of the table list the real client sends. Judging a source
-- table "unreachable" against that snapshot is only sound when the snapshot could, in principle,
-- have named it. A table whose inventory presence began AFTER the harvest was taken cannot be
-- judged by it: absence from the snapshot is then a fact about WHEN the snapshot was taken, never a
-- fact about the client. This is the repo's owner-locked SOURCE IS TRUTH rule — silent -> NULL,
-- never unknown -> NO — applied to a registry instead of to a fetch.
--
-- MEASURED, this is the fourth occurrence of one shape (amlakalahsa 09-12, aqaralsaudia 09-13,
-- then rakez + suwar 09-14). The rakez/suwar pair is the sharpest:
--
--   ops_qa_scope harvested        2026-09-14 08:02:51
--   suwar entered the inventory   2026-09-14 09:23:28  -> P1 raised 09:29:00  (6 min later)
--   rakez entered the inventory   2026-09-14 09:33:31  -> P1 raised 09:59:00  (26 min later)
--
-- Both alerts said "stored, indexed and invisible" over listings a real anonymous search returned
-- on request (rakez 3,670, suwar 96, verified through location_search_candidates_ar with the anon
-- key). The existing 3-day staleness gate cannot see this: at 90 minutes the registry is FRESH by
-- that measure and still blind to the platform in question.
--
-- This does NOT silence the detector -- AGENTS.md forbids that ("make it distinguish cases, and
-- prove both directions"). A table that was already in the inventory when the harvest ran and is
-- in no scope still raises the same P1. Only the un-judgeable window changes verdict, to a P2 that
-- names the real remedy, and it closes by itself on the next harvest: verified after today's
-- re-harvest, rakez and suwar are both judgeable again.

create or replace function public.scope_evidence_can_judge(
  p_table_first_seen    timestamptz,
  p_registry_harvested  timestamptz
) returns boolean
language sql
immutable
as $$
  -- Fail CLOSED on either unknown: a missing timestamp is not permission to pronounce.
  select p_table_first_seen is not null
     and p_registry_harvested is not null
     and p_table_first_seen <= p_registry_harvested;
$$;

comment on function public.scope_evidence_can_judge(timestamptz, timestamptz) is
  'True when a harvested client-scope snapshot is new enough to say anything about a source table: '
  'the table must already have been in the inventory when the snapshot was taken. Fails closed on NULL.';

create or replace function public.mon_detect_search_scope_unreachable_inventory()
 returns integer
 language plpgsql
as $function$
declare
  v_n int := 0; r record;
  v_age interval;
  v_harvested timestamptz;
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
  select min(q.harvested_at) into v_harvested from public.ops_qa_scope q;
  v_age := now() - v_harvested;

  if v_age is null or v_age > c_stale_after then
    -- Withdraw every standing per-table claim. They were derived from evidence now known to be
    -- untrustworthy; leaving them open would keep asserting a fact this detector can no longer
    -- support, which is exactly how the ten false P1s of 2026-09-04 would have outlived their fix.
    for r in
      select a.dedup_key from public.alert_event a
       where a.kind = 'search_scope_unreachable'
         and a.resolved_at is null
         and (a.dedup_key like 'search\_scope\_unreachable:%'
           or a.dedup_key like 'search\_scope\_registry\_behind:%')
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

  -- Evidence is fresh ENOUGH IN AGE -- now judge it TABLE BY TABLE, because age is not the same
  -- question as "could this snapshot have named THIS table".
  for r in
    select s.source_table, count(*) n, min(s.first_seen_at) first_entered
      from public.search_listings_ar s
     where s.production_ready
       and not exists (select 1 from public.ops_qa_scope q where s.source_table = any(q.tables))
     group by 1
  loop
    if public.scope_evidence_can_judge(r.first_entered, v_harvested) then
      -- The snapshot predates this table's inventory presence, so its silence is real evidence.
      v_n := v_n + public.mon_raise('P1', 'search_scope_unreachable',
        split_part(r.source_table, '_', 1),
        'search_scope_unreachable:' || r.source_table,
        jsonb_build_object(
          'source_table', r.source_table,
          'production_ready_rows', r.n,
          'table_first_entered_inventory', r.first_entered,
          'registry_harvested_at', v_harvested,
          'why', format('Every Normal Filter search sends an explicit source_table list. %s is in none of them, so its %s production-ready listings cannot be returned by any search — stored, indexed and invisible.', r.source_table, r.n),
          'fix', 'Either the client scope lost the table or ops_qa_scope is stale; re-harvest (node e2e/qa-coverage/harvest-scope.mjs) before concluding.'));
    else
      -- UNKNOWN, not NO. The table entered the inventory after the harvest, so the harvest could
      -- not have named it whatever the client does. Say what is actually wrong -- the evidence is
      -- behind the platform -- at a severity that asks for a re-harvest instead of announcing an
      -- outage over listings users can very likely reach.
      v_n := v_n + public.mon_raise('P2', 'search_scope_unreachable',
        split_part(r.source_table, '_', 1),
        'search_scope_registry_behind:' || r.source_table,
        jsonb_build_object(
          'source_table', r.source_table,
          'production_ready_rows', r.n,
          'table_first_entered_inventory', r.first_entered,
          'registry_harvested_at', v_harvested,
          'why', format('%s entered the searchable inventory at %s, AFTER the client-scope registry was harvested at %s. The registry therefore cannot say whether the client sends this table, and its silence is NOT evidence of unreachability. Reachability is UNKNOWN, not NO.', r.source_table, r.first_entered, v_harvested),
          'fix', 'Re-harvest from real production requests (node e2e/qa-coverage/harvest-scope.mjs), then let this detector judge the table on evidence that could have seen it. If it is still absent from every scope after a fresh harvest, it escalates to P1 on its own.'));
    end if;
  end loop;

  -- SELF-HEAL: any open per-table claim whose table is reachable again is resolved here. Without
  -- this the detector can only ever accumulate; a corrected registry never cleared the alarm.
  -- Both key shapes are covered, so a registry_behind P2 clears once the harvest catches up --
  -- either silently (the table is reachable) or by the P1 above taking over (it genuinely is not).
  for r in
    select a.dedup_key,
           substring(a.dedup_key from position(':' in a.dedup_key) + 1) as tbl
      from public.alert_event a
     where a.kind = 'search_scope_unreachable'
       and a.resolved_at is null
       and (a.dedup_key like 'search\_scope\_unreachable:%'
         or a.dedup_key like 'search\_scope\_registry\_behind:%')
  loop
    if not exists (
      select 1 from public.search_listings_ar s
       where s.production_ready
         and s.source_table = r.tbl
         and not exists (select 1 from public.ops_qa_scope q where s.source_table = any(q.tables)))
    then
      perform public.mon_resolve_key('search_scope_unreachable', r.dedup_key);
    elsif r.dedup_key like 'search\_scope\_registry\_behind:%'
      and public.scope_evidence_can_judge(
            (select min(s.first_seen_at) from public.search_listings_ar s
              where s.production_ready and s.source_table = r.tbl),
            v_harvested)
    then
      -- The harvest caught up and the table is STILL in no scope: the P1 branch above has now
      -- raised the real finding, so this placeholder must not linger beside it.
      perform public.mon_resolve_key('search_scope_unreachable', r.dedup_key);
    end if;
  end loop;

  return v_n;
end $function$;

-- ── SELF-TESTS, executed at apply time. Both directions, and the wiring. ────────────────────────
do $$
declare v_body text;
begin
  -- 1. Established table: the harvest predates its inventory presence -> judgeable (P1 still fires).
  if not public.scope_evidence_can_judge('2026-06-18 18:20:10+00', '2026-09-15 06:27:31+00') then
    raise exception 'self-test 1 FAILED: an established table must stay judgeable';
  end if;

  -- 2. THE REAL INCIDENT, both rows. Registry 2026-09-14 08:02:51; suwar entered 09:23:28 and
  --    rakez 09:33:31. Neither may be judgeable, or the false P1s of 2026-09-14 recur verbatim.
  if public.scope_evidence_can_judge('2026-09-14 09:23:28.384279+00', '2026-09-14 08:02:51+00') then
    raise exception 'self-test 2a FAILED: suwar (the real false-alarm row) must NOT be judgeable';
  end if;
  if public.scope_evidence_can_judge('2026-09-14 09:33:31.325453+00', '2026-09-14 08:02:51+00') then
    raise exception 'self-test 2b FAILED: rakez (the real false-alarm row) must NOT be judgeable';
  end if;

  -- 3. Equality is judgeable: a harvest taken at the same instant did see the table.
  if not public.scope_evidence_can_judge('2026-09-14 08:02:51+00', '2026-09-14 08:02:51+00') then
    raise exception 'self-test 3 FAILED: equal timestamps must be judgeable';
  end if;

  -- 4. Fails CLOSED on either unknown -- a missing timestamp is not permission to pronounce.
  if public.scope_evidence_can_judge(null, '2026-09-15 06:27:31+00')
     or public.scope_evidence_can_judge('2026-09-14 09:23:28+00', null)
     or public.scope_evidence_can_judge(null, null) then
    raise exception 'self-test 4 FAILED: a NULL timestamp must not be judgeable';
  end if;

  -- 5. WIRING. A pure predicate nothing calls is decoration, and the detector reading it is the
  --    whole point -- so assert the shipped detector body really consults it, on BOTH branches.
  select pg_get_functiondef(p.oid) into v_body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_search_scope_unreachable_inventory';
  if v_body is null or position('scope_evidence_can_judge' in v_body) = 0 then
    raise exception 'self-test 5 FAILED: the detector does not call scope_evidence_can_judge';
  end if;
  if position('search_scope_registry_behind:' in v_body) = 0 then
    raise exception 'self-test 5b FAILED: the detector has no registry_behind branch to fall back to';
  end if;

  raise notice 'scope_evidence_can_judge: all self-tests passed (both directions + wiring)';
end $$;
