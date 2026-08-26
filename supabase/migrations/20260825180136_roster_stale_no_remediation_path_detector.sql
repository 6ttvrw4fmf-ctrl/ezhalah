-- Register mon_detect_stale_no_remediation_path in the detector roster.
--
-- AGENTS.md: "When you add a barrier, add its mon_detect_* wrapper AND its roster entry in the SAME
-- migration: mon_detect_orphaned_detectors() fires on any detector nothing reaches, and a detector
-- outside the roster is decoration."
--
-- The roster is a text[] literal inside mon_run_all_detectors, so adding to it requires replacing the
-- whole function body. Per the full-body-replace hazard rule this is built by NEEDLE-EDITING the
-- LIVE pg_get_functiondef output rather than re-stating a remembered copy, which would silently
-- revert any concurrent change another session made to the roster.
do $mig$
declare d text; anchor constant text := '''mon_detect_stale_active_fraction''';
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';

  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if d like '%mon_detect_stale_no_remediation_path%' then
    raise notice 'already rostered - no-op'; return;
  end if;
  if (select count(*) from regexp_matches(d, anchor, 'g')) <> 1 then
    raise exception 'anchor not unique (%), refusing to needle-edit',
      (select count(*) from regexp_matches(d, anchor, 'g'));
  end if;

  d := replace(d, anchor, anchor || ', ''mon_detect_stale_no_remediation_path''');
  execute d;
  raise notice 'rostered mon_detect_stale_no_remediation_path';
end $mig$;
