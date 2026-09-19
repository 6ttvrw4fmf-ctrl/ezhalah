-- A detector outside mon_run_all_detectors() is decoration: mon_detect_orphaned_detectors() fires
-- on any detector nothing reaches, and AGENTS.md requires the wrapper and the roster entry in the
-- same change. Idempotent — re-running is a no-op, and it refuses rather than guesses if the
-- anchor it splices after is ever renamed.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_wasalt_dead_but_active' in src) > 0 then
    raise notice 'mon_detect_wasalt_dead_but_active already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_prune_kill_without_source_verdict'',',
    E'    ''mon_detect_prune_kill_without_source_verdict'',\n    ''mon_detect_wasalt_dead_but_active'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;
