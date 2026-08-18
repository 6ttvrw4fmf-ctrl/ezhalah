-- Senior run #25 (2026-08-17), method correction.
--
-- 20260817071028 added mon_detect_summary_only_capture to the roster with a wholesale
-- CREATE OR REPLACE of mon_run_all_detectors — a hand-pasted full body. That is the exact defect
-- class 20260810222259 exists to stop: a pasted body silently drops every entry it predates, and it
-- has happened three times in this repo (run #5 on mon_detect_unverified_inactivation, 2026-08-10
-- on six Filter-audit detectors, and the run #22 wholesale rebuild).
-- scripts/verify-detector-roster-edits-are-guarded.ts caught it in CI on PR #722, correctly.
--
-- NOTHING WAS LOST by that apply — verified before writing this: every mon_detect_* absent from the
-- live roster owns its own cron job (aqar_ppm_as_total, district_resolution, price_fidelity,
-- price_magnitude_gate, refresh_coverage, trending_cohort_drift, wasalt_enrich_backlog), and
-- mon_detect_orphaned_detectors() returned 0. This migration therefore does not repair damage; it
-- re-establishes the roster entry through the GUARDED needle-edit so the method in git matches the
-- method the barrier mandates, and so the next session copying this pattern copies the safe one.
--
-- Idempotent by construction: it edits the LIVE body read via pg_get_functiondef and inserts only
-- what is absent, so re-running it (or running it on a roster that already carries the entry, which
-- production does) is a no-op.
do $$
declare
  v_def text;
  v_before text;
  fn text;
  want text[] := array['mon_detect_summary_only_capture'];
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;

  -- Anchor on the LAST roster entry so every insert lands inside the array literal.
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;

  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then
      v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
    end if;
  end loop;

  if v_def = v_before then
    raise notice 'roster already carries mon_detect_summary_only_capture — nothing to do';
    return;
  end if;
  execute v_def;
end $$;

-- Prove it in the same migration: the new entry is reachable AND a set of pre-existing controls
-- survived, so this migration cannot itself have become the thing it is correcting.
do $$
declare
  v_def text; fn text; missing text[] := '{}';
  want text[] := array[
    'mon_detect_summary_only_capture',
    -- CONTROLS: entries that existed before this migration and must not be lost by it.
    'mon_detect_silent_scraper_death','mon_detect_unverified_inactivation',
    'mon_detect_price_eq_area_or_ppm','mon_detect_liveness_cap_degraded',
    'mon_detect_searchability_collapse','mon_detect_price_size_contamination',
    'mon_detect_orphaned_detectors'
  ];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster verification FAILED — missing: %', array_to_string(missing, ', ');
  end if;
  if position('open_alerts' in v_def) = 0 then
    raise exception 'roster return lost open_alerts — standing state would go unreported';
  end if;
end $$;
