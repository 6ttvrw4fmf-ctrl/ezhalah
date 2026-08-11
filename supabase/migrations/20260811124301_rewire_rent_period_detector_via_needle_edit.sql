-- REMEDIATION of my own migration 20260811073933.
--
-- That migration wired mon_detect_rent_period_unreachable into the roster by pasting a full
-- hand-written body of mon_run_all_detectors(). That is precisely the pattern
-- scripts/verify-detector-roster-edits-are-guarded.ts forbids, and it caught me: the roster has been
-- lost at least four times to exactly that move (20260804113911, 20260810175245, 20260810202219,
-- repaired by 20260810222259). I even wrote that history into 073933's own header and then used the
-- pattern anyway, on the reasoning that an explicit 32-detector survival assertion made it safe.
--
-- It did make THAT edit safe. It does not make the pattern safe, and the guard is right to refuse
-- it: an assertion protects the entries the author thought to list, while a needle-edit cannot drop
-- what it never read. The grandfather list in that guard says in as many words that it "must never
-- grow", so exempting this file was not an option — the fix is to stop doing the thing.
--
-- This re-establishes the wiring the sanctioned way: read the LIVE body with pg_get_functiondef(),
-- anchor on the final roster entry, splice only if absent. Idempotent by construction — the detector
-- is already in the live array, so today this changes nothing and simply proves the roster is intact.
-- Its value is that the TREE now describes the roster edit in the only form allowed going forward.
do $$
declare
  v_def text;
  anchor constant text := '''mon_detect_orphaned_detectors''';
  want constant text[] := array['mon_detect_rent_period_unreachable'];
  fn text;
  missing text[] := '{}';
  v_changed boolean := false;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;

  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;

  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then
      v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n    ' || anchor);
      v_changed := true;
    end if;
  end loop;

  if v_changed then
    execute v_def;
  end if;

  -- verify against the LIVE body afterwards, whether or not we edited
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster wiring incomplete: %', array_to_string(missing, ', ');
  end if;
  if position('open_alerts' in v_def) = 0 then
    raise exception 'roster return can no longer report standing alerts';
  end if;

  raise notice 'rent_period detector wired via needle-edit (changed=%)', v_changed;
end $$;

-- Independent of the edit: nothing may have become unreachable. This is the live half of the same
-- protection and it is cheap, so assert it here rather than trusting the next scheduled sweep.
do $$
declare v_orphans int;
begin
  select public.mon_detect_orphaned_detectors() into v_orphans;
  if v_orphans > 0 then
    raise exception 'orphaned detectors after roster edit: %', v_orphans;
  end if;
end $$;
