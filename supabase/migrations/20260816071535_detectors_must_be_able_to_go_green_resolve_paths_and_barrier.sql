-- A BARRIER THAT CANNOT GO GREEN (DIE run #24, 2026-08-16)
--
-- THE DEFECT. Seven mon_detect_* functions call mon_raise() and have NO resolve path of any kind --
-- not mon_resolve_key(), not mon_resolve(), not a raw `update alert_event set resolved_at`. They can
-- open an alert and can never close one. All seven are the 2026-08-10 Filter-audit batch plus
-- loc_rel_capacity_risk / stalled_daily_detector:
--
--   mon_detect_price_size_contamination        mon_detect_trending_district_dead_end
--   mon_detect_location_predicate_drift        mon_detect_search_performance_regression
--   mon_detect_commercial_coverage_blind_spot  mon_detect_loc_rel_capacity_risk
--   mon_detect_stalled_daily_detector
--
-- PROVEN, NOT ASSUMED. alert_event carries P1 `price_size_contamination:index_price_differs_from_raw:aqar`,
-- open since 2026-08-13, detail `{"rows": 16}`. Today mon_price_size_fidelity_barrier() returns ZERO
-- rows on all five of its checks, and the underlying query
--   select count(*) from search_listings_ar s join aqar_residential_listings a on a.id = s.listing_id
--    where s.source_table='aqar_residential_listings' and s.price_annual is distinct from a.price_annual
-- returns 0. The condition cleared; the alert could not.
--
-- WHY THIS IS NOT COSMETIC. Section 11a makes `open_alerts` the standing-state signal precisely because
-- mon_raise() returns 0 for an already-open dedup key, so an all-zero detector sweep is not the same
-- claim as "nothing is wrong". A permanently-stuck alert corrupts that signal from the other side: a
-- healthy system reads as a standing P1 forever. Worse, while the key sits open, a GENUINE
-- re-occurrence at the same severity raises nothing new -- mon_raise() refreshes the payload and
-- returns 0 -- so the roster count stays 0 and nothing re-dispatches. The bug class goes unpaged.
--
-- THE FIX. mon_resolve_stale_keys(kind, live_keys) closes every open alert of a kind whose dedup_key
-- was NOT produced by this run's evaluation. Each of the seven detectors gets one call, appended on
-- its EVALUATED path only -- every slot-gated detector returns 0 before reaching it, so a detector
-- that did not actually run this tick can never resolve anything. Verified 1:1 that no two functions
-- raise the same kind, so a resolve can only ever touch its own detector's alerts.
--
-- Applied as a NEEDLE-EDIT (read the live body with pg_get_functiondef, assert a unique anchor,
-- splice, execute) -- the house pattern from 20260810222259. A needle-edit cannot drop what it never
-- read; a hand-pasted body has silently dropped roster entries seven times in this repo.
--
-- THE PERMANENT BARRIER FOR THE CLASS. mon_detect_unresolvable_detector() raises P2 for any
-- mon_detect_* that calls mon_raise() with no resolve idiom, so the next detector written without one
-- is caught the same hour instead of after three days of false-P1. Rostered in THIS migration
-- (section 11a: a barrier nothing calls is decoration; mon_detect_orphaned_detectors fires otherwise).

-- 1. the helper
create or replace function public.mon_resolve_stale_keys(p_kind text, p_live_keys text[])
returns int
language sql
security definer
set search_path to 'public'
as $fn$
  with done as (
    update public.alert_event
       set resolved_at = now()
     where kind = p_kind
       and resolved_at is null
       and not (dedup_key = any (coalesce(p_live_keys, '{}'::text[])))
    returning 1
  )
  select count(*)::int from done;
$fn$;

comment on function public.mon_resolve_stale_keys(text, text[]) is
  'Closes open alerts of one kind whose dedup_key this run did not re-raise. Call ONLY on a '
  'detector''s evaluated path -- never after an early return from mon_claim_daily_slot(), or a '
  'detector that did not run would resolve alerts it never re-checked. DIE run #24, 2026-08-16.';

-- 2. needle-edit the seven detectors
do $mig$
declare
  v_def text;
  v_name text;
  v_splice text;
  v_pairs text[][] := array[
    ['mon_detect_price_size_contamination',
     '  perform public.mon_resolve_stale_keys(''price_size_contamination'',' || E'\n' ||
     '    (select coalesce(array_agg(''price_size_contamination:''||b.check_name||'':''||b.platform), ''{}'')' || E'\n' ||
     '       from public.mon_price_size_fidelity_barrier() b));'],
    ['mon_detect_trending_district_dead_end',
     '  perform public.mon_resolve_stale_keys(''trending_district'',' || E'\n' ||
     '    (select coalesce(array_agg(''trending_district:''||b.check_name), ''{}'')' || E'\n' ||
     '       from public.mon_trending_district_barrier() b));'],
    ['mon_detect_location_predicate_drift',
     '  perform public.mon_resolve_stale_keys(''location_predicate_drift'',' || E'\n' ||
     '    (select coalesce(array_agg(''location_predicate_drift:''||b.probe_city||'':''||b.probe_deal), ''{}'')' || E'\n' ||
     '       from public.mon_location_predicate_branch_barrier() b));'],
    ['mon_detect_search_performance_regression',
     '  perform public.mon_resolve_stale_keys(''search_performance_regression'',' || E'\n' ||
     '    case when v_broad > 2000 or v_typical > 500' || E'\n' ||
     '         then array[''search_performance_regression:''||current_date::text]' || E'\n' ||
     '         else ''{}''::text[] end);'],
    ['mon_detect_loc_rel_capacity_risk',
     '  perform public.mon_resolve_stale_keys(''loc_rel_capacity_risk'',' || E'\n' ||
     '    (select coalesce(array_agg(k), ''{}'') from (' || E'\n' ||
     '       select ''loc_rel_capacity_risk:stuck:''||source_table k from public.loc_rel_refresh_state' || E'\n' ||
     '        where last_status = ''running'' and last_run_at < now() - interval ''30 minutes''' || E'\n' ||
     '       union all' || E'\n' ||
     '       select ''loc_rel_capacity_risk:starved:''||source_table from public.loc_rel_refresh_state' || E'\n' ||
     '        where coalesce(last_run_at, now() - interval ''1000 hours'') < now() - interval ''30 hours'') q));'],
    ['mon_detect_stalled_daily_detector',
     '  perform public.mon_resolve_stale_keys(''stalled_daily_detector'',' || E'\n' ||
     '    case when cardinality(stalled) > 0' || E'\n' ||
     '         then array[''stalled_daily_detector:''||array_to_string(stalled, '','')]' || E'\n' ||
     '         else ''{}''::text[] end);']
  ];
  i int;
begin
  for i in 1 .. array_length(v_pairs, 1) loop
    v_name   := v_pairs[i][1];
    v_splice := v_pairs[i][2];

    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    if v_def is null then
      raise exception 'detector % is missing -- refusing to guess', v_name;
    end if;

    if position('mon_resolve_stale_keys' in v_def) > 0 then
      raise notice '% already patched', v_name;
      continue;
    end if;

    -- The anchor must be unique, or replace() would splice into a branch we never inspected.
    if (length(v_def) - length(replace(v_def, E'\n  return n;', ''))) / 12 <> 1 then
      raise exception 'anchor "return n;" is not unique in % -- refusing to splice blind', v_name;
    end if;

    v_def := replace(v_def, E'\n  return n;', E'\n' || v_splice || E'\n  return n;');
    execute v_def;
  end loop;
end $mig$;

-- commercial_coverage_blind_spot builds its dedup key inside a dynamic-SQL loop, so its live key set
-- cannot be re-derived as one static expression. Collect the keys in the loop instead -- two further
-- needle-edits, same guarantee.
do $mig$
declare
  v_def text;
  a_decl constant text := 'declare n int := 0; r record; v_active bigint; v_search bigint;';
  a_raise constant text := '      n := n + public.mon_raise(''P1'', ''commercial_coverage_blind_spot'',';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_commercial_coverage_blind_spot';
  if v_def is null then
    raise exception 'mon_detect_commercial_coverage_blind_spot is missing';
  end if;
  if position('mon_resolve_stale_keys' in v_def) > 0 then
    raise notice 'commercial_coverage_blind_spot already patched';
    return;
  end if;
  if position(a_decl in v_def) = 0 or position(a_raise in v_def) = 0 then
    raise exception 'commercial_coverage_blind_spot anchors missing -- refusing to splice blind';
  end if;

  v_def := replace(v_def, a_decl, a_decl || ' live text[] := ''{}'';');
  v_def := replace(v_def, a_raise,
    '      live := live || (''commercial_coverage_blind_spot:'' || r.table_name);' || E'\n' || a_raise);
  v_def := replace(v_def, E'\n  return n;',
    E'\n  perform public.mon_resolve_stale_keys(''commercial_coverage_blind_spot'', live);' ||
    E'\n  return n;');
  execute v_def;
end $mig$;

-- 3. the permanent barrier for the class
create or replace function public.mon_detect_unresolvable_detector()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare n int := 0; bad text[];
begin
  select coalesce(array_agg(p.proname order by p.proname), '{}') into bad
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname like 'mon\_detect\_%'
     and p.prosrc ~* 'mon_raise'
     and p.prosrc !~* '(mon_resolve|resolved_at\s*=\s*now\(\))';

  if cardinality(bad) > 0 then
    n := public.mon_raise('P2', 'unresolvable_detector', 'all', 'unresolvable_detector',
      jsonb_build_object('detectors', to_jsonb(bad), 'count', cardinality(bad),
        'why', 'These detectors can OPEN an alert and can never CLOSE one. Two consequences, and '
            || 'the second is the dangerous one: (1) a cleared condition reads as a standing P1 '
            || 'forever, corrupting the open_alerts signal section 11a relies on; (2) while the key sits '
            || 'open, mon_raise() returns 0 for a genuine RE-occurrence at the same severity, so '
            || 'the roster count stays 0 and nothing re-dispatches -- the bug class goes unpaged. '
            || 'FIX: call mon_resolve_stale_keys(kind, live_keys) on the detector''s EVALUATED path '
            || '(after any mon_claim_daily_slot early return), passing exactly the dedup keys this '
            || 'run re-raised. Never resolve on a path that did not evaluate the condition.'));
  else
    perform public.mon_resolve_key('unresolvable_detector', 'unresolvable_detector');
  end if;
  return n;
end $fn$;

comment on function public.mon_detect_unresolvable_detector() is
  'A barrier must be able to go GREEN, not only red. Raised after DIE run #24 (2026-08-16) found 7 '
  'detectors with no resolve path and a P1 stuck open 3 days on an already-clean condition.';

-- 4. roster the new barrier (guarded needle-edit -- never a pasted body)
do $mig$
declare
  v_def text;
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing -- refusing to guess at the array shape';
  end if;
  if position('''mon_detect_unresolvable_detector''' in v_def) > 0 then
    raise notice 'already rostered';
    return;
  end if;
  v_def := replace(v_def, anchor,
    '    ''mon_detect_unresolvable_detector'',' || E'\n' || anchor);
  execute v_def;
end $mig$;

-- 5. prove it, in the same transaction that changed it
do $mig$
declare
  v_def text; fn text; missing text[] := '{}'; still_bad text[];
  patched text[] := array[
    'mon_detect_price_size_contamination','mon_detect_trending_district_dead_end',
    'mon_detect_location_predicate_drift','mon_detect_search_performance_regression',
    'mon_detect_commercial_coverage_blind_spot','mon_detect_loc_rel_capacity_risk',
    'mon_detect_stalled_daily_detector'];
begin
  -- (a) every one of the seven now carries a resolve call
  foreach fn in array patched loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname='public' and p.proname = fn
                      and p.prosrc like '%mon_resolve_stale_keys%') then
      missing := missing || fn;
    end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'still unresolvable after patch: %', array_to_string(missing, ', ');
  end if;

  -- (b) the class is now empty by the barrier's own definition
  select coalesce(array_agg(p.proname order by p.proname), '{}') into still_bad
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname='public' and p.proname like 'mon\_detect\_%'
     and p.prosrc ~* 'mon_raise' and p.prosrc !~* '(mon_resolve|resolved_at\s*=\s*now\(\))';
  if cardinality(still_bad) > 0 then
    raise exception 'unresolvable detectors remain: %', array_to_string(still_bad, ', ');
  end if;

  -- (c) the roster kept every entry AND gained the new one. CONTROLS are entries that predate this
  --     migration: if a splice had rebuilt the body from a stale copy, these would be gone.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  foreach fn in array array[
    'mon_detect_unresolvable_detector',
    'mon_detect_price_size_contamination','mon_detect_trending_district_dead_end',
    'mon_detect_orphaned_detectors','mon_detect_silent_scraper_death',
    'mon_detect_unverified_inactivation','mon_detect_deploy_lock_misuse'] loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster lost or never gained: %', array_to_string(missing, ', ');
  end if;
  if position('open_alerts' in v_def) = 0 then
    raise exception 'roster return no longer reports standing open alerts';
  end if;
end $mig$;
