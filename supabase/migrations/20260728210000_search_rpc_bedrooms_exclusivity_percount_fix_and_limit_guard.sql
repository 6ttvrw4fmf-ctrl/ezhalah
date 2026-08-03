-- 2026-07-28 filter-correctness sweep — three independent, adversarially-verified defects in
-- location_search_candidates_ar. All three are CONFIRMED but UNREACHABLE from the app today (traced
-- to the single real caller, rpcFilterParams()/fetchListingsForQuery() in src/data/remote.ts) — this
-- is defensive hardening of the RPC contract, not a live-bug fix. No listing data touched; body-only.
--
-- ── FIX 1 · bedrooms OR-leak when p_beds_exact AND p_beds_min are both set ───────────────────────
-- WHERE clause was a flat 3-way OR: p_beds_exact and p_beds_min are NOT mutually exclusive in it — if
-- a caller ever sets both, the row passes when EITHER matches, unioning unrelated bedroom counts
-- instead of picking one. Live-verified (Jeddah/Residential/بيع, p_beds_exact:=[3], p_beds_min:=10):
-- returned bedrooms=3 (3,955 rows) UNIONED with every value from 10 up through a 29,800-bedroom
-- outlier row. Today's only caller (remote.ts:344-345) never sends both (p_beds_exact is a 1-4 array,
-- p_beds_min is only ever exactly 5 or null) — this closes the contract gap for any future caller.
-- Fix: CASE instead of OR — p_beds_exact takes priority and p_beds_min is ignored when both are set,
-- rather than unioned. Identical results for every single-parameter (or neither-set) call.
--
-- ── FIX 2 · total_count wrong in the p_per_platform-partitioned branch ───────────────────────────
-- That branch computed count(*) over() AFTER capping each platform to p_per_platform rows (t.rn <=
-- p_per_platform) — total_count reflected the diversification-capped rowset, not the true pre-cap
-- match count. Live-verified (Riyadh/Residential/بيع, p_per_platform:=5): total_count came back 54
-- instead of the true 35,535 (confirmed via the unpartitioned call on the identical filter). Today's
-- only p_per_platform caller (remote.ts:1098-1103, the platform-diversity seed) never reads
-- total_count from that response — the displayed "X results" always comes from the separate
-- p_per_platform:=null main call (remote.ts:1057-1069), which is unaffected and stays correct.
-- Fix: compute count(*) over() inside the SAME window-function pass that already produces
-- row_number() — i.e. BEFORE the rn <= p_per_platform cap is applied — instead of re-counting the
-- capped set, and instead of re-scanning the (NOT MATERIALIZED) matched CTE a third time.
--
-- ── FIX 3 · p_limit negative crashes instead of degrading safely ─────────────────────────────────
-- p_offset already guards itself (`offset greatest(p_offset, 0)`), but p_limit has no equivalent —
-- `limit p_limit` with p_limit < 0 raises a hard Postgres error ("LIMIT must not be negative") instead
-- of the same graceful degrade p_limit:=0 already gets (0 rows, no error, already verified live).
-- fetchListingsForQuery() (remote.ts:997) is `export`ed and takes an unclamped opts.limit — no current
-- caller passes one (pageLimit is always the QUERY_LIMIT constant, 1500), so this is unreachable today,
-- but any future caller of the exported function is one negative value away from a 500. Fix: clamp with
-- greatest(p_limit, 0), same pattern already used for p_offset.
--
-- Body rebuilt from pg_get_functiondef of the LIVE function per this repo's full-body-replace hazard
-- (see 20260728140000_type_label_compound_and_annual_rent_strictness.sql for the same pattern this
-- migration follows) — three needle-edits, fail-closed if any needle isn't found exactly the expected
-- number of times, identical 35-arg signature so no second overload is created and no GRANT reissue is
-- needed (grants persist across a same-signature CREATE OR REPLACE).
do $rpcfix$
declare
  v_src text;
  v_new text;
  needle_beds text := '(coalesce(cardinality(p_beds_exact), 0) = 0 and p_beds_min is null)
           or (coalesce(cardinality(p_beds_exact), 0) > 0 and s.bedrooms = any(p_beds_exact))
           or (p_beds_min   is not null and s.bedrooms >= p_beds_min))';
  replacement_beds text := '(
             case
               when coalesce(cardinality(p_beds_exact), 0) > 0 then s.bedrooms = any(p_beds_exact)
               when p_beds_min is not null then s.bedrooms >= p_beds_min
               else true
             end
           )';
  needle_count_inner text := 'm.effective_price, m.area_m2, m.bedrooms,
               row_number() over (';
  replacement_count_inner text := 'm.effective_price, m.area_m2, m.bedrooms,
               count(*) over () as total_count,
               row_number() over (';
  needle_count_outer text := 'select t.source_table, t.listing_id, t.platform, t.last_updated, t.region_ar, t.city_ar, t.district_ar,
             count(*) over() as total_count, t.effective_price, t.area_m2, t.bedrooms
      from (';
  replacement_count_outer text := 'select t.source_table, t.listing_id, t.platform, t.last_updated, t.region_ar, t.city_ar, t.district_ar,
             t.total_count, t.effective_price, t.area_m2, t.bedrooms
      from (';
  needle_limit text := 'limit p_limit offset greatest(p_offset, 0)';
  replacement_limit text := 'limit greatest(p_limit, 0) offset greatest(p_offset, 0)';
  occurrences int;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'location_search_candidates_ar'
    and pg_get_function_identity_arguments(p.oid) like '%p_sort_by%';

  if v_src is null then
    raise exception 'location_search_candidates_ar (35-arg, with p_sort_by) not found — aborting rather than guessing a body';
  end if;

  occurrences := (length(v_src) - length(replace(v_src, needle_beds, ''))) / length(needle_beds);
  if occurrences <> 1 then
    raise exception 'bedrooms needle found % times (expected 1) — live body drifted, aborting', occurrences;
  end if;
  v_new := replace(v_src, needle_beds, replacement_beds);

  occurrences := (length(v_new) - length(replace(v_new, needle_count_inner, ''))) / length(needle_count_inner);
  if occurrences <> 1 then
    raise exception 'per-platform inner-subquery needle found % times (expected 1) — live body drifted, aborting', occurrences;
  end if;
  v_new := replace(v_new, needle_count_inner, replacement_count_inner);

  occurrences := (length(v_new) - length(replace(v_new, needle_count_outer, ''))) / length(needle_count_outer);
  if occurrences <> 1 then
    raise exception 'per-platform outer-select needle found % times (expected 1) — live body drifted, aborting', occurrences;
  end if;
  v_new := replace(v_new, needle_count_outer, replacement_count_outer);

  occurrences := (length(v_new) - length(replace(v_new, needle_limit, ''))) / length(needle_limit);
  if occurrences <> 2 then
    raise exception 'limit/offset needle found % times (expected 2, one per branch) — live body drifted, aborting', occurrences;
  end if;
  v_new := replace(v_new, needle_limit, replacement_limit);

  execute v_new;
end
$rpcfix$;

notify pgrst, 'reload schema';
