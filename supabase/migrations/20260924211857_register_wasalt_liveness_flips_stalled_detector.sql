-- Rosters mon_detect_wasalt_liveness_flips_stalled() into mon_run_all_detectors() via an IDEMPOTENT
-- splice on the roster's OWN current body — never a hand-retyped full re-create of the ~150-entry
-- array, which is exactly how a concurrent session's entry got silently dropped earlier today
-- (ops_incident #667: two sessions rewrote this same function two minutes apart, last-writer-wins,
-- no conflict, no error). The anchor RAISES rather than silently no-opping if it has moved.
do $$
declare
  v_body text;
  v_new  text;
  v_anchor constant text := '''mon_detect_city_duplicate_orphaned_districts''';
  v_entry  constant text := '''mon_detect_wasalt_liveness_flips_stalled''';
begin
  select prosrc into v_body
    from pg_proc
   where proname = 'mon_run_all_detectors' and pronamespace = 'public'::regnamespace;

  if v_body is null then
    raise exception 'mon_run_all_detectors() not found — cannot splice the roster';
  end if;

  if position(v_entry in v_body) > 0 then
    return; -- already spliced (idempotent re-run)
  end if;

  if position(v_anchor in v_body) = 0 then
    raise exception 'roster anchor not matched: % — update this migration''s anchor to a stable, '
      'currently-present entry before re-running', v_anchor;
  end if;

  v_new := replace(v_body, v_anchor, v_anchor || ', ' || v_entry);

  execute 'create or replace function public.mon_run_all_detectors() returns jsonb '
       || 'language plpgsql as $wasalt_flips_roster$' || v_new || '$wasalt_flips_roster$';
end $$;

-- Assert reachability immediately, in the same migration, rather than trusting the splice.
do $$
begin
  if position('mon_detect_wasalt_liveness_flips_stalled' in
      (select prosrc from pg_proc where proname = 'mon_run_all_detectors'
         and pronamespace = 'public'::regnamespace)) = 0 then
    raise exception 'splice did not take — mon_detect_wasalt_liveness_flips_stalled still unreachable';
  end if;
end $$;
