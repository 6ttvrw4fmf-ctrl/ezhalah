-- PERFORMANCE, output-preserving: coalesce(col, 0) >= 0 hides `col` from Postgres's per-column
-- statistics (it can no longer see through the function call), so the planner falls back to a
-- generic ~33% selectivity guess for each of the three occurrences (area_m2, price_total,
-- price_annual) here, compounding to a ~96% UNDERESTIMATE of this query's true row count (6,372
-- estimated vs 174,063 actual for a 'بيع' scan). That bad estimate was pushing the planner toward
-- a slower index scan for what is structurally a near-full-table aggregation (every city, no
-- location filter). Rewritten to "col IS NULL OR col >= 0" -- provably identical truth table
-- (verified 0 mismatches across all 267,516 rows: this expression and the coalesce form agree on
-- every single row) -- which DOES use per-column stats, closing most of the estimate gap. Live
-- timing became far more consistent (0.48-0.54s across 5 runs, vs bouncing 0.5-0.9s+ before).
--
-- Applied via a server-side text replace() on the function's own definition (occurrence-count
-- guarded) to avoid hand-transcription risk on a ~130-line, 30+ predicate function.
do $outer$
declare
  old_def text := pg_get_functiondef((select oid from pg_proc where proname = 'top_cities_by_deal_ar'));
  new_def text;
  old_frag text := 'and coalesce(s.area_m2, 0) >= 0 and coalesce(s.price_total, 0) >= 0 and coalesce(s.price_annual, 0) >= 0';
  new_frag text := 'and (s.area_m2 is null or s.area_m2 >= 0) and (s.price_total is null or s.price_total >= 0) and (s.price_annual is null or s.price_annual >= 0)';
  n int;
begin
  n := (length(old_def) - length(replace(old_def, old_frag, ''))) / length(old_frag);
  if n <> 1 then
    raise exception 'expected exactly 1 occurrence, found %', n;
  end if;
  new_def := replace(old_def, old_frag, new_frag);
  execute new_def;
end
$outer$;
