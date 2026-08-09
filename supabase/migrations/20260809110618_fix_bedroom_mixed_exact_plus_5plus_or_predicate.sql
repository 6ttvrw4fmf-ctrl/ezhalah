-- Filter QA (2026-08-05). Bedroom multi-select bug. The bedroom predicate in the search RPC
-- location_search_candidates_ar AND the two guided-count RPCs (apartment_guided_counts_ar,
-- property_age_option_counts_ar) was a PRIORITY CASE:
--     case when coalesce(cardinality(p_beds_exact),0) > 0 then s.bedrooms = any(p_beds_exact)
--          when p_beds_min is not null then s.bedrooms >= p_beds_min
--          else true end
-- The bedroom chips are a genuine multi-select (index.tsx contextBedsList): picking an exact count
-- AND "5+" together sends BOTH p_beds_exact=[3] and p_beds_min=5. Under the priority-CASE, p_beds_min
-- was never evaluated once p_beds_exact was non-empty, so ALL 5+ listings were silently dropped and
-- never returned (Buy+الرياض "3 or 5+" returned 8,699 instead of 22,145; 13,446 five-plus rows lost).
-- The documented contract (src/data/search.ts bedroomFilter) is an OR across chosen counts; the
-- client-side re-filter can only narrow the fetched page, it cannot recover rows the RPC never sent.
--
-- Fix: replace the priority-CASE with an OR so both bounds combine. Pure single-bucket (only exact,
-- or only 5+) and pure multi-exact behaviour are unchanged; only the mixed exact+5+ case gains its
-- missing rows. Applied to prod via apply_migration as version 20260809110618; this file back-fills
-- the repo. Regression guard: scripts/check_audit_invariants.py::check_bedroom_or asserts
-- count("3 or 5+") == count(3) + count(>=5) on a live scope.
--
-- Guarded needle-edit from each LIVE definition; fails closed (rolls back) if a needle does not match.
do $mig$
declare
  r record; src text; out text;
  pat text := $q$and \(case\s+when coalesce\(cardinality\(p_beds_exact\),\s*0\)\s*>\s*0 then (\w+)\.bedrooms = any\(p_beds_exact\)\s+when p_beds_min is not null then \w+\.bedrooms\s*>=\s*p_beds_min\s+else true\s+end\)$q$;
  rep text := $q$and ((coalesce(cardinality(p_beds_exact),0) = 0 and p_beds_min is null) or (coalesce(cardinality(p_beds_exact),0) > 0 and \1.bedrooms = any(p_beds_exact)) or (p_beds_min is not null and \1.bedrooms >= p_beds_min))$q$;
begin
  for r in
    select oid, proname from pg_proc
    where proname in ('location_search_candidates_ar','apartment_guided_counts_ar','property_age_option_counts_ar')
      and pg_get_functiondef(oid) ~ 'when p_beds_min is not null then'
  loop
    src := pg_get_functiondef(r.oid);
    out := regexp_replace(src, pat, rep);
    if out = src then raise exception 'bedroom needle not matched in %', r.proname; end if;
    if position('p_beds_min is null) or' in out) = 0 then raise exception 'bedroom OR missing after edit in %', r.proname; end if;
    execute out;
    raise notice 'bedroom OR applied to %', r.proname;
  end loop;
end
$mig$;
