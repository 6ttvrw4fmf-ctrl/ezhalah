
-- PERFORMANCE, output-preserving: district_options_ar's "live" CTE was calling
-- norm_district_tok(district_ar) -- an IMMUTABLE but expensive ~8-step regexp/translate chain --
-- on every row of the city's cohort, on every picker open. Measured (Riyadh, 54,924-row cohort):
-- 577ms with the function call vs 72ms reading a plain column -- ~88% of this RPC's total latency.
-- migration 20260926-a added public.search_listings_ar.district_norm_tok as a STORED GENERATED
-- column (norm_district_tok(district_ar), verified 0 mismatches across all 267,516 rows). This
-- migration is the two-line swap to actually read it: cohort now also selects district_norm_tok,
-- and "live" groups on that stored column instead of recomputing the function. Applied via a
-- server-side text replace() on the function's own live definition (verified diff: exactly these
-- two spots changed, everything else byte-identical) to avoid any hand-transcription risk on a
-- ~150-line, 30+ predicate function.
do $outer$
declare
  old_def text := pg_get_functiondef((select oid from pg_proc where proname = 'district_options_ar'));
  new_def text;
begin
  new_def := replace(old_def,
    'select s.district_ar' || chr(10) || '    from public.search_listings_ar s',
    'select s.district_ar, s.district_norm_tok' || chr(10) || '    from public.search_listings_ar s');

  new_def := replace(new_def,
    'SELECT norm_district_tok(district_ar) AS tok, count(*)::int AS n' || chr(10) || '    FROM cohort WHERE district_ar IS NOT NULL GROUP BY 1',
    'SELECT district_norm_tok AS tok, count(*)::int AS n' || chr(10) || '    FROM cohort WHERE district_ar IS NOT NULL GROUP BY 1');

  if new_def = old_def then
    raise exception 'replace() made no change -- refusing to apply a no-op';
  end if;

  execute new_def;
end
$outer$;
