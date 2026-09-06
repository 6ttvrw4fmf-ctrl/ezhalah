-- Put mon_detect_stalled_incident and mon_detect_alert_queue_unworked on the detector roster.
--
-- A detector outside mon_run_all_detectors()'s array is decoration -- AGENTS.md is explicit that the
-- wrapper and the roster entry ship in the SAME migration, and mon_detect_orphaned_detectors() fires
-- on anything nothing reaches.
--
-- WHY A NEEDLE EDIT INSTEAD OF PASTING THE WHOLE FUNCTION. Five routines add detectors to this one
-- 158-entry array, and DATA_INTEGRITY_ENGINEER.md warns that a wholesale CREATE OR REPLACE built
-- from a body read minutes earlier "would silently drop another session's detector". Reading and
-- rewriting the body inside ONE statement closes that window completely: there is no interval in
-- which a concurrent session's append can be lost. Doing it inside a migration (rather than a bare
-- DO block) is what keeps production and git in step -- an in-place function change with no
-- migration record is drift the four-condition guard cannot even see, because it compares versions.
--
-- Fails closed three ways: the anchor must exist, the two names must actually appear afterwards, and
-- the roster must grow by exactly two -- so a clobber or a silent no-op raises instead of passing.
do $mig$
declare
  v_src        text;
  v_new        text;
  v_anchor     text := '''mon_detect_ungated_expensive_detector''' || E'\n  ];';
  v_replace    text := '''mon_detect_ungated_expensive_detector'',' || E'\n'
                    || '    ''mon_detect_stalled_incident'',' || E'\n'
                    || '    ''mon_detect_alert_queue_unworked''' || E'\n  ];';
  v_before_cnt int;
  v_after_cnt  int;
begin
  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_src is null then
    raise exception 'mon_run_all_detectors() not found -- refusing to guess';
  end if;

  -- already rostered? then this migration is a no-op, not a failure (idempotent re-runs).
  if position('mon_detect_stalled_incident' in v_src) > 0
     and position('mon_detect_alert_queue_unworked' in v_src) > 0 then
    raise notice 'both detectors already on the roster; nothing to do';
    return;
  end if;

  if position(v_anchor in v_src) = 0 then
    raise exception 'roster anchor not found -- the array tail changed shape. Re-derive the anchor '
                    'from pg_proc.prosrc rather than forcing this edit.';
  end if;

  v_before_cnt := (length(v_src) - length(replace(v_src, 'mon_detect_', ''))) / length('mon_detect_');

  v_new := replace(v_src, v_anchor, v_replace);

  execute format(
    'create or replace function public.mon_run_all_detectors() returns jsonb language plpgsql as %L',
    v_new);

  select prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  v_after_cnt := (length(v_src) - length(replace(v_src, 'mon_detect_', ''))) / length('mon_detect_');

  if position('mon_detect_stalled_incident' in v_src) = 0
     or position('mon_detect_alert_queue_unworked' in v_src) = 0 then
    raise exception 'post-edit verification failed: the new detectors are not on the roster';
  end if;
  if v_after_cnt <> v_before_cnt + 2 then
    raise exception 'roster changed by % entries, expected exactly 2 -- possible clobber of a concurrent append',
                    v_after_cnt - v_before_cnt;
  end if;

  raise notice 'roster grew % -> %', v_before_cnt, v_after_cnt;
end $mig$;
