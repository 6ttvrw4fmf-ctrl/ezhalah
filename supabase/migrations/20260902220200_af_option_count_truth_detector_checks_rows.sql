-- THE DETECTOR NOW READS THE ROWS IT WAS BUILT TO READ (H9 of the AF matrix certification,
-- 2026-09-02). mon_detect_af_option_count_truth called ops_af_option_truth_sweep with
-- `p_row_limit := 1, p_check_rows := false` — so the third surface (location_search_candidates_ar,
-- the listings the user actually receives) and the row-level re-read of the predicate
-- (`count(*) filter (where not (row_pred))`) never executed in production. The sweep proved chip ==
-- applied and nothing more; a count and a set can agree and both be wrong.
--
-- COST, measured 2026-09-02 on the heaviest cohort (شقة/بيع, ~38k rows): one row check at
-- p_limit 200 = 1.65 s; the count-only pass for its 41 options ≈ 10 s (20260902004000). With rows
-- that cohort is ≈ 10 + 41 × 1.65 ≈ 80 s. The 20-slice layout put ~3 cohorts in a run — up to
-- ~240 s for a heavy slice, inside one twice-hourly sweep that shares a 900 s statement budget with
-- every other detector (detector_sweep_budget watches the headroom). 40 slices puts 1–2 cohorts in
-- a run (59 enabled), worst case ≈ 160 s, typical far less; full coverage every 40 days instead of
-- 20. Same trade 20260902004000 made and for the same reason: this detector watches drift that
-- only a migration can introduce, and the repo-side barriers catch that at PR time — the runtime
-- backstop may be slow, it may not be blind.
--
-- Needle-edited on the LIVE body (anchors must occur exactly once, else refuse). The alert payload
-- now also carries rows_returned / rows_violating so the adjudicator sees which surface lied.

do $mig$
declare v_def text; v_new text;
  v_call_old constant text := '      p_row_limit := 1, p_check_rows := false,';
  v_call_new constant text := '      p_row_limit := 200, p_check_rows := true,';
  v_slices_old constant text := '  SLICES constant int := 20;            -- ~3 cohorts per run; full coverage every 20 days';
  v_slices_new constant text := '  SLICES constant int := 40;            -- 1-2 cohorts per run WITH row checks (~80 s heaviest cohort, measured 2026-09-02); full coverage every 40 days';
  v_bad_old constant text := '      ''count_shown_on_chip'', r.chip, ''count_the_filter_returns'', r.applied);';
  v_bad_new constant text := '      ''count_shown_on_chip'', r.chip, ''count_the_filter_returns'', r.applied,' || E'\n' ||
                             '      ''rows_returned'', r.returned, ''rows_violating_the_predicate'', r.viol);';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_af_option_count_truth';
  if v_def is null then raise exception 'mon_detect_af_option_count_truth not found'; end if;
  -- already applied? Test the CALL line, not the phrase: the adjudicate prose has carried
  -- 'p_check_rows := true' since 20260902004000 (caught by the rolled-back dry run 2026-09-02).
  if position(v_call_new in v_def) > 0 then return; end if;
  if position(v_call_old in v_def) = 0 then raise exception 'call anchor not found — refusing to guess'; end if;
  if position(v_slices_old in v_def) = 0 then raise exception 'SLICES anchor not found — refusing to guess'; end if;
  if position(v_bad_old in v_def) = 0 then raise exception 'offender anchor not found — refusing to guess'; end if;
  v_new := replace(v_def, v_call_old, v_call_new);
  v_new := replace(v_new, v_slices_old, v_slices_new);
  v_new := replace(v_new, v_bad_old, v_bad_new);
  if length(v_new) <= length(v_def) then raise exception 'edit did not grow the body'; end if;
  execute v_new;
  -- proof the edit landed where it claims: the live body must now carry all three edits, once each.
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_af_option_count_truth';
  if position(v_call_new in v_def) = 0 or position(v_slices_new in v_def) = 0 or position('rows_violating_the_predicate' in v_def) = 0 then
    raise exception 'post-edit body does not carry the three edits';
  end if;
end
$mig$;
