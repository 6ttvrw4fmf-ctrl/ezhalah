-- PERFORMANCE, semantics-preserving (Filter audit, 2026-08-10).
--
-- The location predicate ORs three columns. All three ALREADY have indexes (idx_slar_city_norm,
-- idx_slar_city_id, GIN idx_slar_match_city_ids, idx_slar_district_tok) but none could ever be used:
-- `x IN (SELECT ... FROM cte)` plans as a hashed SubPlan, and a hashed SubPlan is not an index
-- condition. So every search fell back to scanning a broad index (deal_ar or type_ar) and discarding
-- the rest by filter — 73,716 rows discarded on Riyadh/Buy, 89,853 buffers touched, 590 ms.
--
-- `x = ANY (ARRAY(SELECT ...))` is the SAME predicate written so the planner can use it: ARRAY() is
-- an InitPlan evaluated once into a constant array, which makes the comparison a ScalarArrayOpExpr —
-- indexable, and combinable across the OR branches as a BitmapOr.
--
-- SEMANTICS ARE IDENTICAL, including the empty and NULL edges:
--   • `x IN (empty set)` = false;  ARRAY(empty subquery) = '{}' (NOT null), so `x = ANY('{}')` = false.
--     This is why ARRAY() is used rather than array_agg(), which would return NULL on no rows.
--   • a NULL element makes both forms NULL (never true) for a non-matching x — same OR outcome.
--   • x IS NULL yields NULL in both forms.
-- `&&` is left exactly as it was: GIN already handles it, and it is not an equality test.
--
-- NOT a rewrite of what the predicate MEANS. The three branches, their order, and the whole rest of
-- the function are untouched. Rewriting the OR into `city_id = any(...)` alone — the "obvious"
-- optimization — would silently drop the city_ar text branch and the match_city_ids branch and
-- change which listings match. That is refused: this is the version that cannot change a result.
--
-- Verified by digest parity over 12 query shapes (city/district/twin/region/no-location/types+price+
-- beds/sort/offset/category/rent-period/multi-city) captured in tmp_rpc_parity_snapshot BEFORE this
-- migration; the post-migration check asserts identical total_count AND identical ordered row digest.
do $$
declare
  v_def text;
  v_new text;
  n1 int; n2 int; n3 int;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'location_search_candidates_ar';

  if v_def is null then raise exception 'location_search_candidates_ar not found'; end if;

  -- Assert the live body still has exactly the shapes we expect. Drift ⇒ abort, never guess-patch.
  select count(*) into n1 from regexp_matches(v_def,
    'normalize_ar\(s\.city_ar\) in \(select tok from city_tokens\)', 'g');
  select count(*) into n2 from regexp_matches(v_def,
    's\.city_id in \(select city_id from city_ids\)', 'g');
  select count(*) into n3 from regexp_matches(v_def,
    'norm_district_tok\(s\.district_ar\) in \(select tok from district_tokens\)', 'g');

  if n1 <> 1 or n2 <> 1 or n3 <> 1 then
    raise exception 'live body drifted from expected shape (city_norm=%, city_id=%, district=%)', n1, n2, n3;
  end if;

  v_new := replace(v_def,
    'normalize_ar(s.city_ar) in (select tok from city_tokens)',
    'normalize_ar(s.city_ar) = any (array(select tok from city_tokens))');
  v_new := replace(v_new,
    's.city_id in (select city_id from city_ids)',
    's.city_id = any (array(select city_id from city_ids))');
  v_new := replace(v_new,
    'norm_district_tok(s.district_ar) in (select tok from district_tokens)',
    'norm_district_tok(s.district_ar) = any (array(select tok from district_tokens))');

  if v_new = v_def then raise exception 'needle-edit produced no change'; end if;

  execute v_new;
end $$;