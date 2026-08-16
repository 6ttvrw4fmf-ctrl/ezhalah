-- FOLLOW-UP TO THE SAME RUN (DIE #24, 2026-08-16): the fix was correct and its COST was not.
--
-- The first migration derived each detector's live dedup-key set by re-running its barrier inside
-- mon_resolve_stale_keys(...). For three of the seven that means evaluating an expensive barrier
-- TWICE per detector run. Measured immediately after applying it:
--   mon_price_size_fidelity_barrier()  =  25,698 ms  for ONE evaluation (0 rows returned)
-- so the patched detector needed ~51 s and blew a 60 s statement budget -- inside cron jobid 38,
-- which sweeps every 30 minutes. A detector that times out raises detector_crash and stops
-- protecting its bug class: strictly worse than the stuck-alert defect being fixed. Caught here by
-- running the patched path rather than trusting that it was cheap (section 19 -- the measurement is
-- the likelier defect, and this run had already made three measurement errors before this one).
--
-- THE CORRECTION. Collect the dedup keys in the loop that already iterates the barrier, exactly as
-- mon_detect_commercial_coverage_blind_spot does, and pass that array. One evaluation, same
-- semantics, no second scan. The other four detectors are untouched: their live-key expressions are
-- a pure CASE over values already computed (search_performance_regression, stalled_daily_detector)
-- or a scan of the tiny loc_rel_refresh_state table.
--
-- Needle-edits again: read the live body, assert the anchors, splice. Never a pasted body.

do $mig$
declare
  v_def text;
  v_name text; v_kind text; v_key_expr text;
  v_pairs text[][] := array[
    ['mon_detect_price_size_contamination', 'price_size_contamination',
     '''price_size_contamination:'' || r.check_name || '':'' || r.platform'],
    ['mon_detect_trending_district_dead_end', 'trending_district',
     '''trending_district:'' || r.check_name'],
    ['mon_detect_location_predicate_drift', 'location_predicate_drift',
     '''location_predicate_drift:'' || r.probe_city || '':'' || r.probe_deal']
  ];
  a_decl constant text := 'declare n int := 0; r record;';
  a_raise constant text := '    n := n + public.mon_raise(';
  i int;
begin
  for i in 1 .. array_length(v_pairs, 1) loop
    v_name := v_pairs[i][1]; v_kind := v_pairs[i][2]; v_key_expr := v_pairs[i][3];

    select pg_get_functiondef(p.oid) into v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    if v_def is null then raise exception 'detector % is missing', v_name; end if;

    if position(' live text[]' in v_def) > 0 then
      raise notice '% already collects in-loop', v_name; continue;
    end if;
    if position(a_decl in v_def) = 0 then
      raise exception 'declare anchor missing in % -- refusing to splice blind', v_name;
    end if;
    if (length(v_def) - length(replace(v_def, a_raise, ''))) / length(a_raise) <> 1 then
      raise exception 'raise anchor is not unique in % -- refusing to splice blind', v_name;
    end if;
    if position('mon_resolve_stale_keys' in v_def) = 0 then
      raise exception '% was never patched -- apply the first migration first', v_name;
    end if;

    -- 1. declare the accumulator
    v_def := replace(v_def, a_decl, a_decl || ' live text[] := ''{}'';');
    -- 2. record the key on the same iteration that raises it
    v_def := replace(v_def, a_raise,
      '    live := live || (' || v_key_expr || ');' || E'\n' || a_raise);
    -- 3. replace the whole second-evaluation block with the collected array
    v_def := regexp_replace(v_def,
      E'\n  perform public\\.mon_resolve_stale_keys\\(.*?\\n  return n;',
      E'\n  perform public.mon_resolve_stale_keys(''' || v_kind || ''', live);' || E'\n  return n;',
      'ns');
    execute v_def;
  end loop;
end $mig$;

-- prove it in the same transaction
do $mig$
declare fn text; src text; bad text[] := '{}';
begin
  foreach fn in array array['mon_detect_price_size_contamination',
                            'mon_detect_trending_district_dead_end',
                            'mon_detect_location_predicate_drift'] loop
    select p.prosrc into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname = fn;
    -- still resolves...
    if src not like '%mon_resolve_stale_keys%' then bad := bad || (fn || ':no_resolve'); end if;
    -- ...collects in the loop...
    if src not like '% live text[]%' then bad := bad || (fn || ':no_accumulator'); end if;
    -- ...and no longer calls its barrier a second time. Each barrier must appear exactly ONCE.
    if (length(src) - length(replace(src, 'mon_price_size_fidelity_barrier', ''))) / 31 > 1
       or (length(src) - length(replace(src, 'mon_trending_district_barrier', ''))) / 29 > 1
       or (length(src) - length(replace(src, 'mon_location_predicate_branch_barrier', ''))) / 37 > 1
    then bad := bad || (fn || ':barrier_still_evaluated_twice'); end if;
  end loop;
  if cardinality(bad) > 0 then
    raise exception 'in-loop collection incomplete: %', array_to_string(bad, ', ');
  end if;

  -- the class stays empty: no detector may regress to raise-without-resolve
  if exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
              where ns.nspname='public' and p.proname like 'mon\_detect\_%'
                and p.prosrc ~* 'mon_raise'
                and p.prosrc !~* '(mon_resolve|resolved_at\s*=\s*now\(\))')
  then raise exception 'an unresolvable detector reappeared'; end if;
end $mig$;
