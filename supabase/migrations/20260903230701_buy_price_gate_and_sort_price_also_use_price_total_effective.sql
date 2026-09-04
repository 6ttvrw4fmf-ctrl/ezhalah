-- Finish the job the previous migration started, and prove it with counts rather than assume it.
--
-- Rewiring the two budget COMPARISONS was not enough: the Buy branch is guarded upstream by a hard
-- precondition, "s.price_total is not null and s.price_total > 0". A per-metre-only row has a NULL
-- price_total by definition, so it was dropped before the comparison ever ran. Measured on
-- abralosol 400k-900k: the filter returned 535 while the truth was 897 — exactly the 362 derived
-- rows still missing.
--
-- Three shapes move to price_total_effective, all Buy-side:
--   1. the eligibility precondition   (s.price_total is not null and s.price_total > 0)
--   2. the same precondition inside the OR branch
--   3. effective_price, which orders and displays the result — so a derived total sorts and renders
--      in the same units as a published one, instead of the row sorting as price-less.
--
-- Deliberately NOT touched: coalesce(s.price_total, 0) >= 0 (a no-op sanity term) and
-- search_row_price_gated(s.deal_ar, s.price_total), which judges a SOURCE-published price and must
-- keep judging exactly that. Needle-edited from the live definitions.
DO $do$
DECLARE
  fn text; oid_ oid; def text; newdef text; n int;
BEGIN
  FOREACH fn IN ARRAY ARRAY['location_search_candidates_ar','af_eligible_count',
                            'apartment_guided_counts_ar','property_age_option_counts_ar'] LOOP
    select p.oid into oid_ from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace
     where n2.nspname='public' and p.proname=fn limit 1;
    def := pg_get_functiondef(oid_);
    newdef := def;

    newdef := replace(newdef,
      'and s.price_total is not null and s.price_total > 0',
      'and s.price_total_effective is not null and s.price_total_effective > 0');
    newdef := replace(newdef,
      'or (s.price_total is not null and s.price_total > 0',
      'or (s.price_total_effective is not null and s.price_total_effective > 0');
    newdef := replace(newdef,
      'coalesce(s.price_total, s.price_annual) as effective_price',
      'coalesce(s.price_total_effective, s.price_annual) as effective_price');

    if newdef = def then
      raise notice '% unchanged (nothing to rewire)', fn;
    else
      execute newdef;
      select count(*) into n from regexp_matches(newdef, 'price_total_effective', 'g');
      raise notice 'rewired % (% effective refs)', fn, n;
    end if;
  END LOOP;
END
$do$;

NOTIFY pgrst, 'reload schema';

select 'abralosol 400k-900k' label,
  (select af_eligible_count(p_platforms:=array['abralosol'], p_deal:='بيع', p_price_min:=400000, p_price_max:=900000)) af_count,
  (select count(*) from location_search_candidates_ar(p_platforms:=array['abralosol'], p_deal:='بيع', p_price_min:=400000, p_price_max:=900000, p_limit:=50000)) clicked,
  (select count(*) from search_listings_ar where platform='abralosol' and deal_ar='بيع' and price_total_effective between 400000 and 900000) db_truth;
