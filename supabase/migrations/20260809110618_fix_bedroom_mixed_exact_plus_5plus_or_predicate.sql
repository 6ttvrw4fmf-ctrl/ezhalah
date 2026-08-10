-- Filter QA (2026-08-05). Bedroom multi-select bug (a prior fix 20260728210000 was reverted by a
-- later RPC full-body rewrite — hence the nightly guard). The bedroom predicate in the search RPC
-- location_search_candidates_ar AND the two guided-count RPCs (apartment_guided_counts_ar,
-- property_age_option_counts_ar) was a PRIORITY CASE: p_beds_exact won and p_beds_min was ignored
-- whenever exact was set. The chips are a multi-select, so "3"+"5+" sends BOTH p_beds_exact=[3] and
-- p_beds_min=5 and silently dropped every 5+ listing (Buy+الرياض "3 or 5+": 8,699 instead of 22,145).
-- Fix: priority-CASE -> OR (restores the documented src/data/search.ts bedroomFilter contract).
-- Applied to prod via apply_migration as 20260809110618. Guarded needle-edit; fails closed.
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
  end loop;
end
$mig$;
