-- THE DEFECT: mon_run_all_detectors() was rebuilt from a STALE copy of its own body and silently
-- dropped six detectors — the third occurrence of this exact class.
--
-- Timeline, all 2026-08-10 (prod migration versions):
--   20:13:09  wire_filter_audit_barriers_into_daily_detector_roster  → +5 Filter-audit detectors
--   20:18:33  daily_gate_expensive_filter_detectors                  → +mon_detect_stalled_daily_detector
--                                                                       (guarded NEEDLE-EDIT: correct)
--   20:22:19  price_area_artifact_fix_repair_and_barrier             → full CREATE OR REPLACE of the
--             roster, commented "rebuilt from the current live body, verified this session". The body
--             it pasted had been captured BEFORE 20:13, so replacing wholesale reverted the roster
--             and dropped all six.
--   20:22:40  mon_detect_orphaned_detectors raised P2 alert 413 — 21 seconds later. The barrier
--             worked perfectly; nothing acted on it for two hours.
--
-- Precedent: run #5 (2026-08-04) recorded 20260803194308 doing the identical thing to
-- mon_detect_unverified_inactivation 8h after it was wired. mon_detect_orphaned_detectors' own
-- header names that incident. A hand-copied full body is how this keeps happening; a guarded
-- needle-edit (what 20:18:33 used, and what this migration uses) cannot lose an entry it never read.
--
-- Also rosters the three detectors shipped earlier today and never wired at all
-- (mon_detect_zero_price_served 07:00, mon_detect_filter_barrier_leaks 12:52,
-- mon_detect_deploy_lock_misuse 13:15) — alert 409 named them at 17:52. Measured cost before
-- rostering: 87 ms / 161 ms / 2 ms, all raising 0. Cheap enough for the twice-hourly sweep ungated;
-- the five Filter-audit detectors carry their own 20h gate internally.
--
-- SECOND DEFECT FIXED HERE: the roster's return value could not distinguish "nothing wrong" from
-- "already-open alert". mon_raise() returns 0 when its dedup key is already open and not escalated,
-- so the documented daily health contract — "`failed` must be empty and every count 0" — read as a
-- clean bill of health at 22:13 today while 9 detectors were dark and 25 alerts were open, alert 413
-- among them. Counts are NEW-or-escalated alerts, and that is genuinely what they should be; the
-- gap is that nothing reported standing state. `open_alerts` now rides along in the same jsonb, so
-- one call answers both questions and a run can no longer be certified healthy by silence.

do $$
declare
  v_def text;
  v_before text;
  fn text;
  want text[] := array[
    'mon_detect_price_size_contamination',
    'mon_detect_trending_district_dead_end',
    'mon_detect_location_predicate_drift',
    'mon_detect_search_performance_regression',
    'mon_detect_commercial_coverage_blind_spot',
    'mon_detect_stalled_daily_detector',
    'mon_detect_zero_price_served',
    'mon_detect_filter_barrier_leaks',
    'mon_detect_deploy_lock_misuse'
  ];
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
  ret_old constant text := 'jsonb_build_object(''ran_at'', now(), ''failed'', to_jsonb(failed))';
  ret_new constant text :=
    'jsonb_build_object(''ran_at'', now(), ''failed'', to_jsonb(failed),' || E'\n'
    || '    ''open_alerts'', (select coalesce(jsonb_object_agg(severity, c), ''{}''::jsonb)' || E'\n'
    || '                       from (select severity, count(*) c from public.alert_event' || E'\n'
    || '                              where resolved_at is null group by severity) s))';
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

  -- Honest standing state alongside the newly-raised counts.
  if position('open_alerts' in v_def) = 0 then
    if position(ret_old in v_def) = 0 then
      raise exception 'return-shape needle not found — not editing the return blind';
    end if;
    v_def := replace(v_def, ret_old, ret_new);
  end if;

  if v_def = v_before then
    raise notice 'roster already complete — nothing to do';
    return;
  end if;
  execute v_def;
end $$;

-- Prove it, in the same transaction that changed it: every wanted detector is now reachable, the
-- pre-existing entries survived, and the return carries standing state.
do $$
declare
  v_def text; fn text; missing text[] := '{}';
  want text[] := array[
    'mon_detect_price_size_contamination','mon_detect_trending_district_dead_end',
    'mon_detect_location_predicate_drift','mon_detect_search_performance_regression',
    'mon_detect_commercial_coverage_blind_spot','mon_detect_stalled_daily_detector',
    'mon_detect_zero_price_served','mon_detect_filter_barrier_leaks',
    'mon_detect_deploy_lock_misuse',
    -- CONTROLS: entries that existed before this migration and must not have been lost by it.
    'mon_detect_silent_scraper_death','mon_detect_unverified_inactivation',
    'mon_detect_price_eq_area_or_ppm','mon_detect_orphaned_detectors'
  ];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster restore incomplete: %', array_to_string(missing, ', ');
  end if;
  if position('open_alerts' in v_def) = 0 then
    raise exception 'roster return still cannot report standing alerts';
  end if;
end $$;
