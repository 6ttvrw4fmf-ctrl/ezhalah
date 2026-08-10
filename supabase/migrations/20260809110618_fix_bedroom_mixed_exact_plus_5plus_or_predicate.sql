-- Filter QA (2026-08-05): bedroom multi-select bug. The bedroom predicate in the search + 2 guided
-- count RPCs was a PRIORITY CASE (p_beds_exact wins; p_beds_min ignored when exact is non-empty).
-- A mixed multi-select like "3" + "5+" sends BOTH p_beds_exact=[3] and p_beds_min=5, so all 5+
-- listings were silently dropped (Buy+الرياض "3 or 5+": 8,699 instead of 22,145). The documented
-- contract (src/data/search.ts bedroomFilter) is an OR across chosen counts — this restores that OR.
-- Guarded needle-edit built from each LIVE def; fails closed (rolls back) if a needle doesn't match.
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
