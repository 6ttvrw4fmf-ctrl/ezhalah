-- 2026-08-03 defense-in-depth (P3): PR#258 (20260728210000_search_rpc_bedrooms_exclusivity_percount_
-- fix_and_limit_guard.sql) hardened location_search_candidates_ar's p_beds_exact/p_beds_min flat
-- 3-way OR into a priority CASE (p_beds_exact wins outright when both are set, instead of unioning
-- every bedroom count from p_beds_min upward). The identical flat-OR pattern independently exists in
-- the two counts RPCs that back the advanced-filter chip badges: apartment_guided_counts_ar and
-- property_age_option_counts_ar. Same fix, same CASE shape, applied here so the chip counts can never
-- drift from search's row-level semantics if a future caller ever sends both params.
--
-- Pure logic fix — no data mutation, no plausibility guard, no signature change (bodies only, same
-- 22-arg / 19-arg identity, so no GRANT reissue needed). Bodies rebuilt from pg_get_functiondef of the
-- LIVE functions per this repo's full-body-replace hazard convention (see PR#258 and the
-- 20260730101002_rpc_parity_and_sync_tracking_bughunt.sql needle-edit precedent for these same two
-- functions) — guarded needle-edits, fail-closed if either needle isn't found exactly once.
--
-- NOTE on PR#258's needle/replacement shape: PR#258's own needle_beds/replacement_beds strings (as
-- committed in 20260728210000, not yet deployed) are parenthesis-unbalanced — the needle consumes the
-- outer wrapping ")" of the `and (... )` clause while the replacement re-wraps the CASE in its own
-- fresh, self-contained parens, leaving one `(` from the preceding literal `and (` permanently
-- unclosed. Confirmed live via a pg_temp sandbox rebuild of location_search_candidates_ar using
-- PR#258's exact literals: `ERROR 42601: syntax error at or near "select"`. That migration is out of
-- this task's file scope (only these two counts RPCs were named) so it is left untouched here, but the
-- same defect is NOT reproduced below: the needles here stop at the single close paren that ends the
-- third OR-arm (not the outer wrapper's paren), and the replacements are bare `case…end` with no
-- self-wrapping parens, so the original `and ( … )` wrapper is left in place and does the closing —
-- verified paren-balanced and executable in a pg_temp sandbox before being written here.

do $rpcfix$
declare
  v_src text;
  v_new text;
  -- apartment_guided_counts_ar's live body has no space after the cardinality(...) comma.
  needle_guided text := '(coalesce(cardinality(p_beds_exact),0) = 0 and p_beds_min is null)
           or (coalesce(cardinality(p_beds_exact),0) > 0 and s.bedrooms = any(p_beds_exact))
           or (p_beds_min   is not null and s.bedrooms >= p_beds_min)';
  replacement_guided text := 'case
               when coalesce(cardinality(p_beds_exact),0) > 0 then s.bedrooms = any(p_beds_exact)
               when p_beds_min is not null then s.bedrooms >= p_beds_min
               else true
             end';
  -- property_age_option_counts_ar's live body has a space after the cardinality(...) comma.
  needle_age text := '(coalesce(cardinality(p_beds_exact), 0) = 0 and p_beds_min is null)
           or (coalesce(cardinality(p_beds_exact), 0) > 0 and s.bedrooms = any(p_beds_exact))
           or (p_beds_min   is not null and s.bedrooms >= p_beds_min)';
  replacement_age text := 'case
               when coalesce(cardinality(p_beds_exact), 0) > 0 then s.bedrooms = any(p_beds_exact)
               when p_beds_min is not null then s.bedrooms >= p_beds_min
               else true
             end';
  occurrences int;
begin
  -- ── A) apartment_guided_counts_ar ──────────────────────────────────────────────
  v_src := pg_get_functiondef('public.apartment_guided_counts_ar'::regproc);

  occurrences := (length(v_src) - length(replace(v_src, needle_guided, ''))) / length(needle_guided);
  if occurrences <> 1 then
    raise exception 'apartment_guided_counts_ar bedrooms needle found % times (expected 1) — live body drifted, aborting', occurrences;
  end if;
  v_new := replace(v_src, needle_guided, replacement_guided);

  execute v_new;

  -- ── B) property_age_option_counts_ar ───────────────────────────────────────────
  v_src := pg_get_functiondef('public.property_age_option_counts_ar'::regproc);

  occurrences := (length(v_src) - length(replace(v_src, needle_age, ''))) / length(needle_age);
  if occurrences <> 1 then
    raise exception 'property_age_option_counts_ar bedrooms needle found % times (expected 1) — live body drifted, aborting', occurrences;
  end if;
  v_new := replace(v_src, needle_age, replacement_age);

  execute v_new;
end
$rpcfix$;

notify pgrst, 'reload schema';
