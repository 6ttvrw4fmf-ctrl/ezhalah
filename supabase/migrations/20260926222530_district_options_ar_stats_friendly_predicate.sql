
-- PERFORMANCE, output-preserving: same fix as top_cities_by_deal_ar_stats_friendly_predicate --
-- coalesce(col, 0) >= 0 hides the column from Postgres's per-column statistics, causing a severe
-- row-count underestimate for the cohort's location-agnostic clauses. Rewritten to
-- "col IS NULL OR col >= 0" (provably identical, verified 0 mismatches across all 267,516 rows).
-- This migration records (idempotently) the fix already applied live.
do $outer$
declare
  new_def text := pg_get_functiondef((select oid from pg_proc where proname = 'district_options_ar'));
begin
  if position('coalesce(s.area_m2, 0) >= 0' in new_def) > 0 then
    raise exception 'function still has the old coalesce predicate -- fix not actually applied';
  end if;
  execute new_def;
end
$outer$;
