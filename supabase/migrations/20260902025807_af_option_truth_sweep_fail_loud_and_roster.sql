-- Records, as a versioned migration, two changes that were first applied through execute_sql during
-- the 2026-09-01 AF certification. Both are needle edits against the LIVE body — re-running them is a
-- no-op — but an unversioned schema change is drift, and the engineer who applies it owns mirroring
-- it in the same change (AGENTS.md).

-- 1. THE SWEEP MUST FAIL LOUD. A cohort whose counts could not be read was skipped in silence, so a
--    sweep that measured NOTHING looked exactly like a sweep that found nothing wrong. That is the
--    dark-detector shape this repo has been burned by; it now reports the cohort as a defect row.
do $mig$
declare v_def text; v_new text;
  v_needle constant text := '    continue when v_counts is null;';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ops_af_option_truth_sweep';
  if v_def is null then raise exception 'ops_af_option_truth_sweep not found'; end if;
  if position('COHORT UNMEASURABLE' in v_def) > 0 then return; end if;         -- already applied
  if position(v_needle in v_def) = 0 then raise exception 'anchor not found — refusing to guess'; end if;
  v_new := replace(v_def, v_needle,
    '    if v_counts is null then' || E'\n' ||
    '      cohort := c.type_ar || ''|'' || c.deal_ar || ''|'' || coalesce(c.rent_period_ar, ''-'');' || E'\n' ||
    '      opt := ''COHORT UNMEASURABLE: apartment_guided_counts_ar returned no row'';' || E'\n' ||
    '      chip := null; applied := null; returned := null; viol := null; return next; continue;' || E'\n' ||
    '    end if;');
  if length(v_new) <= length(v_def) then raise exception 'edit did not grow the body'; end if;
  execute v_new;
end
$mig$;

-- 2. ROSTER. mon_detect_af_option_count_truth must be reachable from mon_run_all_detectors, or it is
--    decoration — mon_detect_orphaned_detectors exists to catch exactly that. NEEDLE EDIT, never a
--    rewrite: rebuilding this 10KB roster from a remembered body is how a CREATE OR REPLACE silently
--    reverts every detector another session added (the RPC full-body-replace hazard).
do $mig$
declare v_def text; v_new text;
  v_needle constant text := '    ''mon_detect_af_coverage_cliff'',';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('mon_detect_af_option_count_truth' in v_def) > 0 then return; end if;   -- already on it
  if position(v_needle in v_def) = 0 then raise exception 'anchor not found — refusing to guess'; end if;
  v_new := replace(v_def, v_needle, v_needle || E'\n    ''mon_detect_af_option_count_truth'',');
  if length(v_new) <= length(v_def) then raise exception 'edit did not grow the body'; end if;
  execute v_new;
end
$mig$;
