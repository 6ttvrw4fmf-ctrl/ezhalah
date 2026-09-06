-- An adjudicated supersession is a DECISION, not a contradiction.
--
-- WHAT WAS WRONG. mon_detect_lifecycle_duplicate_stale_copy() raises when one source URL exists in
-- both a platform's residential and commercial table with exactly one copy active. Its prescribed
-- remedy is "fetch the shared listing_url once and make BOTH copies match what the source returns —
-- restore both if it serves the page". Measured 2026-09-06 by routine #11: on dealapp, ALL FIVE
-- reported pairs are rows the 20260830140110 residential/commercial collision repair DELIBERATELY
-- retired, and every one is recorded in ops_adjudicated_listing. The shared URL is live at source
-- (3 of the 5 probed directly: HTTP 200 with the listing's own title), so following the advice
-- verbatim would have RESTORED the retired copies — undoing a correct repair and putting a
-- mis-typed duplicate back into search. Two of them are a محطة بنزين (Gas Station) whose retired
-- copy sits in the RESIDENTIAL table carrying the raw Arabic type string.
--
-- So the detector was not reporting a contradiction. It was reporting a settled decision, in a
-- shape whose own remedy is harmful, on a platform-wide alert (5/5 pairs) that would never clear.
-- auto_recover_false_inactive() already refuses to undo an adjudication (20260902071952); this
-- brings the detector into line with that rule instead of arguing with it.
--
-- WHAT THIS DOES NOT DO. It does not silence the alert to make it green (AGENTS.md: "make the
-- barrier distinguish cases, and prove both directions"). The 13 pairs across aqaratikom,
-- eaqartabuk, mustqr, sadin and sanadak carry NO adjudication and still raise, unchanged. It
-- narrows one reporting function by exactly the set the rest of the system has already decided.
--
-- AND IT PROVES ITSELF ON EVERY SWEEP. The decision is lifted out of the generator into
-- ops_lifecycle_dead_copy_is_a_contradiction(), which takes an optional injected adjudication set,
-- so the detector executes it against synthetic inputs in BOTH directions before doing any real
-- work — an adjudicated copy must be excluded, a plain one must be reported. If either direction
-- stops holding, the detector raises lifecycle_duplicate_detector_blind instead of quietly
-- reporting whatever it happens to compute. A guard nobody has watched fail is a comment that runs.

-- ── The decision, separated from the generator so it can be executed against injected inputs ─────
create or replace function public.ops_lifecycle_dead_copy_is_a_contradiction(
  p_dead_table text,
  p_dead_id    bigint,
  p_inject     jsonb default null
) returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- TRUE  = a genuine contradiction: nothing on record explains why this copy is inactive while its
  --         twin is active and served, so one of the two is wrong and the source must adjudicate.
  -- FALSE = a recorded decision: ops_adjudicated_listing carries this exact row, so its inactive
  --         state was CHOSEN (res/com collision repair, retraction, sibling supersession) and is not
  --         a disagreement with anything.
  --
  -- p_inject, when given, replaces the ledger with an array of {"tbl": …, "listing_id": …} objects.
  -- It exists ONLY so the detector can run this predicate against synthetic rows on every sweep; it
  -- reads nothing and writes nothing.
  select case
    when p_inject is not null then not exists (
      select 1 from jsonb_array_elements(p_inject) e
       where e->>'tbl' = p_dead_table
         and (e->>'listing_id')::bigint = p_dead_id)
    else not exists (
      select 1 from public.ops_adjudicated_listing a
       where a.tbl = p_dead_table and a.listing_id = p_dead_id)
  end
$$;

comment on function public.ops_lifecycle_dead_copy_is_a_contradiction(text, bigint, jsonb) is
  'Is an inactive res/com twin a genuine contradiction, or a recorded adjudication? Called by '
  'ops_lifecycle_duplicate_stale_copy() and executed against injected inputs, both directions, by '
  'mon_detect_lifecycle_duplicate_stale_copy() on every sweep.';

-- ── The generator, now asking that question ──────────────────────────────────────────────────────
create or replace function public.ops_lifecycle_duplicate_stale_copy()
 returns table(platform text, listing_url text, dead_table text, dead_id bigint, live_table text, live_id bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  r record;
begin
  for r in
    select regexp_replace(t.table_name, '_(residential|commercial)_listings$', '') as p
      from information_schema.tables t
     where t.table_schema = 'public' and t.table_name ~ '_(residential|commercial)_listings$'
     group by 1
    having count(*) filter (where t.table_name like '%\_residential\_listings') = 1
       and count(*) filter (where t.table_name like '%\_commercial\_listings')  = 1
  loop
    -- Both tables must actually carry listing_url; a platform captured without it cannot be joined on
    -- identity and is skipped rather than guessed at.
    if (select count(*) from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name in (r.p || '_residential_listings', r.p || '_commercial_listings')
           and c.column_name = 'listing_url') <> 2 then
      continue;
    end if;

    return query execute format($q$
      select %1$L::text, res.listing_url,
             case when res.active is not true then %2$L else %3$L end::text,
             case when res.active is not true then res.id  else com.id  end,
             case when res.active is not true then %3$L else %2$L end::text,
             case when res.active is not true then com.id  else res.id  end
        from public.%2$I res
        join public.%3$I com on com.listing_url = res.listing_url
       where res.listing_url is not null
         and (res.active is not true) <> (com.active is not true)
         -- An inactive copy the adjudication ledger accounts for is a DECISION, not a
         -- contradiction. Restoring it would undo a repair (20260830140110) and re-create the
         -- duplicate that repair removed.
         and public.ops_lifecycle_dead_copy_is_a_contradiction(
               case when res.active is not true then %2$L else %3$L end,
               case when res.active is not true then res.id  else com.id  end)
         and exists (
           select 1 from public.search_listings_ar s
            where (s.source_table = %2$L and s.listing_id = res.id and res.active is true)
               or (s.source_table = %3$L and s.listing_id = com.id and com.active is true))
    $q$, r.p, r.p || '_residential_listings', r.p || '_commercial_listings');
  end loop;
end;
$function$;

-- ── The detector, now proving its own predicate before it reports anything ───────────────────────
create or replace function public.mon_detect_lifecycle_duplicate_stale_copy()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n     int := 0;
  live  text[] := '{}';
  blind text[] := '{}';
  r     record;
  t     text := 'dealapp_residential_listings';
begin
  -- SELF-TEST, executed, both directions, before any real work. The injected ledger names row 42 of
  -- a real table; the predicate must EXCLUDE that row (a recorded decision) and INCLUDE row 43
  -- (nothing on record). A predicate that always answers the same way is the failure mode that
  -- would either silence the whole alert or restore the exclusion's blind spot, and neither should
  -- be discoverable only by someone re-reading the SQL.
  if public.ops_lifecycle_dead_copy_is_a_contradiction(
       t, 42, jsonb_build_array(jsonb_build_object('tbl', t, 'listing_id', 42))) then
    blind := array_append(blind, 'an ADJUDICATED dead copy was still reported as a contradiction');
  end if;
  if not public.ops_lifecycle_dead_copy_is_a_contradiction(
       t, 43, jsonb_build_array(jsonb_build_object('tbl', t, 'listing_id', 42))) then
    blind := array_append(blind, 'an UNADJUDICATED dead copy was excluded — the alert would go dark');
  end if;
  if not public.ops_lifecycle_dead_copy_is_a_contradiction(
       t, 42, '[]'::jsonb) then
    blind := array_append(blind, 'an EMPTY ledger excluded a row — every pair would be suppressed');
  end if;
  if public.ops_lifecycle_dead_copy_is_a_contradiction(
       'some_other_table', 42, jsonb_build_array(jsonb_build_object('tbl', t, 'listing_id', 42)))
     is not true then
    blind := array_append(blind, 'the ledger matched a DIFFERENT table — the exclusion is too wide');
  end if;

  if array_length(blind, 1) is not null then
    n := n + public.mon_raise('P2', 'lifecycle_duplicate_detector_blind', null,
      'lifecycle_duplicate_detector_blind',
      jsonb_build_object(
        'failures', to_jsonb(blind),
        'why', 'ops_lifecycle_dead_copy_is_a_contradiction() no longer answers correctly on injected '
            || 'inputs, so whatever mon_detect_lifecycle_duplicate_stale_copy() reports below cannot '
            || 'be trusted in either direction.',
        'action', 'Fix the predicate. Do NOT relax this self-test to make it green.'));
  else
    perform public.mon_resolve_key('lifecycle_duplicate_detector_blind', 'lifecycle_duplicate_detector_blind');
  end if;

  for r in
    select d.platform,
           count(*)                                                as pairs,
           (array_agg(d.listing_url order by d.listing_url))[1:10] as sample_urls,
           (array_agg(d.live_table  order by d.listing_url))[1:10] as live_tables
      from public.ops_lifecycle_duplicate_stale_copy() d
     group by 1
  loop
    live := live || ('lifecycle_duplicate_stale_copy:' || r.platform);
    -- P2, honestly: the contradiction is proven, its DIRECTION is not. Neither copy has been checked
    -- against the source by this detector, and it must not imply that the served one is the wrong one.
    n := n + public.mon_raise('P2', 'lifecycle_duplicate_stale_copy', r.platform,
      'lifecycle_duplicate_stale_copy:' || r.platform,
      jsonb_build_object(
        'platform', r.platform,
        'contradicting_pairs', r.pairs,
        'sample_listing_urls', to_jsonb(r.sample_urls),
        'served_from', to_jsonb(r.live_tables),
        'why', 'These source URLs exist in BOTH this platform''s residential and commercial table. '
            || 'One copy is inactive, the other is active and still returned by search — so our two '
            || 'records of the same page on the source disagree about whether that page still exists. '
            || 'One of them is wrong and this detector cannot tell which. Pairs whose inactive copy '
            || 'is recorded in ops_adjudicated_listing are NOT counted here: those are decisions, '
            || 'not disagreements.',
        'do_not', 'Do NOT resolve this by copying the dead state onto the live twin. That would be a '
            || 'deactivation justified by our own bookkeeping instead of by the source, which is the '
            || 'rule (LISTING_LIVENESS.md §1: only a DIRECT fetch may kill) this routine exists to '
            || 'protect. Equally, do not reactivate the dead copy on the strength of its twin. And do '
            || 'NOT blanket-restore: if the two rows are ONE source listing captured into two tables, '
            || 'restoring the retired copy re-creates a duplicate card, usually carrying the WRONG '
            || 'property type (measured 2026-09-06: a محطة بنزين retired out of the residential table).',
        'action', 'Fetch the shared listing_url directly, once. If the source SERVES it, the live '
            || 'copy is right and the question becomes which table this listing belongs in — retire '
            || 'the wrong-typed sibling, do not resurrect it. If the source says GONE, that is one '
            || 'DIRECT strike against the live copy, not a deactivation: let the contract reach '
            || 'grace. Then find why one listing was captured into two tables — the residential/'
            || 'commercial URL collision repaired by migration 20260830140110 is the known shape.'));
  end loop;

  perform public.mon_resolve_stale_keys('lifecycle_duplicate_stale_copy', live);
  return n;
end;
$function$;
