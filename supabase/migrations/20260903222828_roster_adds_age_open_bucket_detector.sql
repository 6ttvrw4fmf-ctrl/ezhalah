-- Put the open-bucket detector on the roster. AGENTS.md: a detector nothing calls is decoration,
-- and mon_detect_orphaned_detectors fires on any detector outside mon_run_all_detectors. Added in
-- the same change as the detector itself, per the repo rule that the wrapper and the roster entry
-- ship together.
DO $do$
DECLARE def text; newdef text;
BEGIN
  def := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);

  IF position('mon_detect_age_open_bucket_stored_as_precise' in def) > 0 THEN
    RAISE NOTICE 'already on the roster'; RETURN;
  END IF;

  -- Splice the new name in beside a stable existing member rather than rebuilding the list.
  newdef := replace(def,
    '''mon_detect_af_tri_state_violations''',
    '''mon_detect_af_tri_state_violations'', ''mon_detect_age_open_bucket_stored_as_precise''');

  IF newdef = def THEN
    RAISE EXCEPTION 'roster anchor not found — refusing to guess at the list shape';
  END IF;

  EXECUTE newdef;
END
$do$;

select (pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)
        ilike '%mon_detect_age_open_bucket_stored_as_precise%') as on_roster;
