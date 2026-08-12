-- Guarded needle-edit (per scripts/verify-detector-roster-edits-are-guarded.ts and the precedent in
-- 20260810222259_restore_roster_detectors_dropped_by_stale_rebuild.sql) wiring
-- mon_detect_loc_rel_capacity_risk (added in the companion migration
-- dealapp_loc_rel_capacity_fix_batching_cron_timeout_and_barrier) into mon_run_all_detectors()'s
-- roster WITHOUT pasting a static copy of the array — reads the LIVE body via pg_get_functiondef
-- and inserts a single new entry, so a concurrent session's own roster addition can never be
-- silently reverted by this migration.
do $$
declare
  v_def text;
  v_before text;
  anchor constant text := '''mon_detect_orphaned_detectors''';
  want constant text := 'mon_detect_loc_rel_capacity_risk';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;

  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;

  if position('''' || want || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, anchor || ', ''' || want || '''');
  end if;

  if v_def = v_before then
    raise notice 'roster already includes %— nothing to do', want;
    return;
  end if;
  execute v_def;
end $$;

-- Prove it: the new detector is reachable and every pre-existing entry survived.
do $$
declare
  v_def text; fn text; missing text[] := '{}';
  want text[] := array[
    'mon_detect_loc_rel_capacity_risk',
    -- CONTROLS: entries that must not have been lost.
    'mon_detect_silent_scraper_death','mon_detect_unverified_inactivation',
    'mon_detect_price_eq_area_or_ppm','mon_detect_orphaned_detectors',
    'mon_detect_priceless_rent_with_labelled_source_price',
    'mon_detect_searchability_collapse','mon_detect_served_after_source_confirmed_gone'
  ];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster wiring incomplete: %', array_to_string(missing, ', ');
  end if;
end $$;
