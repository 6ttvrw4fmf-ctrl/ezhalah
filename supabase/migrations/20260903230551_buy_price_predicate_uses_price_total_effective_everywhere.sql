-- Point every Buy-budget predicate at price_total_effective so the Filter, the counts and the
-- Advanced Filter share ONE pricing semantic (owner rule 2026-09-03).
--
-- Before this, a per-metre-only listing could never match a budget search: the predicate read
-- price_total, which is NULL for those rows by design. 2,640 sale listings were unreachable by any
-- price filter. price_total_effective resolves to the SOURCE total when there is one and to the
-- derived per-metre x area total otherwise, so the four entry points below now agree by construction
-- rather than by four copies of the same edit.
--
-- NEEDLE-EDITED FROM THE LIVE DEFINITION, never a hand-retyped body (repo rule: a full-body replace
-- silently reverts whatever else shipped since). Only the two PREDICATE shapes are rewritten:
--     s.price_total >= coalesce(p_price_min ...
--     s.price_total <= coalesce(nullif(p_price_max ...
-- location_search_candidates_ar also SELECTS price_total into its payload; that mention is left
-- alone on purpose, so the card still receives the source-published total and can tell the two
-- apart. The rent predicates (price_annual) are untouched — nothing is derived for rent.
DO $do$
DECLARE
  fn      text;
  oid_    oid;
  def     text;
  newdef  text;
  n_min   int;
  n_max   int;
BEGIN
  FOREACH fn IN ARRAY ARRAY['location_search_candidates_ar','af_eligible_count',
                            'apartment_guided_counts_ar','property_age_option_counts_ar'] LOOP
    select p.oid into oid_ from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname = fn limit 1;
    if oid_ is null then raise exception 'missing function %', fn; end if;

    def := pg_get_functiondef(oid_);

    if position('price_total_effective >= coalesce(p_price_min' in def) > 0 then
      raise notice '% already migrated', fn; continue;
    end if;

    select count(*) into n_min from regexp_matches(def, 's\.price_total >= coalesce\(p_price_min', 'g');
    select count(*) into n_max from regexp_matches(def, 's\.price_total <= coalesce\(nullif\(p_price_max', 'g');
    if n_min <> 2 or n_max <> 2 then
      raise exception '% has an unexpected price-clause shape (min=%, max=%) — refusing to edit blind',
        fn, n_min, n_max;
    end if;

    newdef := replace(def, 's.price_total >= coalesce(p_price_min',
                           's.price_total_effective >= coalesce(p_price_min');
    newdef := replace(newdef, 's.price_total <= coalesce(nullif(p_price_max',
                              's.price_total_effective <= coalesce(nullif(p_price_max');

    execute newdef;
    raise notice 'rewired % (2 min + 2 max clauses)', fn;
  END LOOP;
END
$do$;

-- PostgREST must see the reshaped functions or search returns nothing (the 2026-07-16 lesson).
NOTIFY pgrst, 'reload schema';

select p.proname,
       (select count(*) from regexp_matches(pg_get_functiondef(p.oid), 'price_total_effective', 'g')) effective_refs,
       (select count(*) from regexp_matches(pg_get_functiondef(p.oid), 's\.price_total >= coalesce\(p_price_min', 'g')) leftover_old_min
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('location_search_candidates_ar','af_eligible_count','apartment_guided_counts_ar','property_age_option_counts_ar')
order by p.proname;
