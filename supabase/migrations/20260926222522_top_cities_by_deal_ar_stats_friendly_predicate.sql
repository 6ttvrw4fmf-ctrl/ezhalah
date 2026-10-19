
-- PERFORMANCE, output-preserving: coalesce(col, 0) >= 0 hides `col` from Postgres's per-column
-- statistics (it can no longer see through the function call), so the planner falls back to a
-- generic ~33% selectivity guess for each of the three occurrences (area_m2, price_total,
-- price_annual) here, compounding to a ~96% UNDERESTIMATE of this query's true row count (6,372
-- estimated vs 174,063 actual for a 'بيع' scan). That bad estimate was pushing the planner toward
-- a slower index scan for what is structurally a near-full-table aggregation (every city, no
-- location filter). Rewritten to "col IS NULL OR col >= 0" -- provably identical truth table
-- (verified 0 mismatches across all 267,516 rows) -- which DOES use per-column stats, closing
-- most of the estimate gap. Live timing became far more consistent (0.48-0.54s across 5 runs, vs
-- bouncing 0.5-0.9s+ before). This migration records (idempotently) the fix already applied live.
do $outer$
declare
  new_def text := pg_get_functiondef((select oid from pg_proc where proname = 'top_cities_by_deal_ar'));
begin
  if position('coalesce(s.area_m2, 0) >= 0' in new_def) > 0 then
    raise exception 'function still has the old coalesce predicate -- fix not actually applied';
  end if;
  execute new_def;
end
$outer$;
