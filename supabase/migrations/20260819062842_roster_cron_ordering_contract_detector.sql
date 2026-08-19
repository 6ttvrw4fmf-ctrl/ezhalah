-- Roster entry for mon_detect_cron_ordering_contract (Senior Production Engineer run #30).
-- A detector nothing reaches is decoration; mon_detect_orphaned_detectors fires on exactly that.
--
-- GUARDED NEEDLE-EDIT (per 20260810222259_restore_roster_detectors_dropped_by_stale_rebuild.sql):
-- reads the LIVE mon_run_all_detectors body via pg_get_functiondef and splices ONE entry in. A
-- wholesale CREATE OR REPLACE of this function silently drops every roster entry its author's copy
-- predated — the failure class verify-detector-roster-edits-are-guarded.ts exists to stop. A
-- needle-edit never has to know what else is in the array, so it cannot lose what it never read.
do $$
declare
  v_def text;
  v_before text;
  anchor constant text := '''mon_detect_orphaned_detectors''';
  add    constant text := 'mon_detect_cron_ordering_contract';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;

  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;

  -- Idempotent: only splice if the entry is not already present (prod already carries it).
  if position('''' || add || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, anchor || ', ''' || add || '''');
  end if;

  if v_def = v_before then
    raise notice 'roster already carries % — nothing to do', add;
    return;
  end if;
  execute v_def;
end $$;

-- Prove it in the same transaction: the new entry is reachable AND pre-existing controls survived.
do $$
declare
  v_def text; fn text; missing text[] := '{}';
  want text[] := array[
    'mon_detect_cron_ordering_contract',
    -- CONTROLS: entries that existed before this migration and must not have been lost by it.
    'mon_detect_silent_scraper_death','mon_detect_zero_new_stall',
    'mon_detect_english_overlay_stranded_city','mon_detect_orphaned_detectors',
    'mon_detect_run_log_timestamps_inverted'
  ];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster edit incomplete or dropped entries: %', array_to_string(missing, ', ');
  end if;
  if position('open_alerts' in v_def) = 0 then
    raise exception 'roster return can no longer report standing alerts';
  end if;
end $$;
