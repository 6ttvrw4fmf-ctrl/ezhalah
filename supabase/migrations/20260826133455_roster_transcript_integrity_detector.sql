-- Register mon_detect_transcript_integrity in the detector roster (AGENTS.md: a detector outside the
-- roster is decoration, and mon_detect_orphaned_detectors() fires on any detector nothing reaches).
-- Needle-edits the LIVE definition rather than restating the array, per the full-body-replace hazard.
do $mig$
declare d text; anchor constant text := '''mon_detect_stale_active_fraction''';
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if d like '%mon_detect_transcript_integrity%' then raise notice 'already rostered - no-op'; return; end if;
  if (select count(*) from regexp_matches(d, anchor, 'g')) <> 1 then
    raise exception 'anchor not unique, refusing to needle-edit';
  end if;
  d := replace(d, anchor, anchor || ', ''mon_detect_transcript_integrity''');
  execute d;
  raise notice 'rostered mon_detect_transcript_integrity';
end $mig$;
