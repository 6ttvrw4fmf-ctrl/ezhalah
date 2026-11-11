-- 🔧 2026-11-09 (repair queue: cheap_yearly_rent_served, 2 rows, open since 11-07).
-- aqar 1924571 (Workshop, 20,105 m²) and 11197701 (Warehouse, 21,946 m²) publish «200» / «150» in the price box and the
-- SAME figure as the per-metre rate. enforce_price_size_sanity() (owner 2026-11-07, «the same figure in both price boxes»)
-- names that box a copy of the rate and empties the rent price: the index correctly serves NULL and the card shows the
-- rate. This detector compared the index with rent_price_annual_ar() alone, so it read that correct withholding as
-- «off the ×12 rule» for two days. It now expects exactly what the write path does: when price_box_equals_rate_ar()
-- says 'rate' for the rule's figure, the expected served price is NULL. A row that serves a price there is still
-- off-rule and still raises (the trigger bypassed). The pool, the 8,000 threshold and the type list are untouched.
CREATE OR REPLACE FUNCTION public.mon_detect_cheap_yearly_rent_served()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0;
  v_on boolean;
  v_bad int;
  v_sample jsonb;
begin
  select k.enabled into v_on from public.ops_feature_flags k where k.name = 'cheap_yearly_is_monthly';
  if not coalesce(v_on, false) then
    perform public.mon_resolve_key('cheap_yearly_rent_served', 'cheap_yearly_rent_served');
    return 0;
  end if;
  -- THE INVARIANT: what the index serves for a rent row is what the rule says for that row's source inputs, after the
  -- same price-box gate the write path applies (enforce_price_size_sanity: a price box holding the rate is emptied).
  with ruled as (
    select s.platform, s.listing_id, s.price_annual as served, v.price_annual as published, v.rent_period as site_word, v.property_type,
           s.price_per_meter, s.area_m2,
           (case when s.price_in_thousands then 1000 else 1 end) * (case when s.rent_period_judged and v.platform not in ('gathern', 'aqarmonthly') and v.rent_period is null and public.judge_silent_rent_period_ar((case when s.price_in_thousands then 1000 else 1 end) * coalesce(v.price_annual, v.price_total), s.type_ar) = 'شهري' then coalesce(v.price_annual, v.price_total) * 12 else public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type) end) as per_rule
      from public.search_listings_ar s
      join public.listing_native_location_v2 v on v.source_table = s.source_table and v.listing_id = s.listing_id
     where s.production_ready and s.deal_ar = 'إيجار'
  ), off_rule as (
    select r.platform, r.listing_id, r.served, r.published, r.site_word, r.property_type, r.per_rule,
           (public.price_box_equals_rate_ar('إيجار', r.per_rule, r.price_per_meter, r.area_m2) = 'rate') as box_is_rate
      from ruled r
     where r.served is distinct from
           case when public.price_box_equals_rate_ar('إيجار', r.per_rule, r.price_per_meter, r.area_m2) = 'rate' then null
                else r.per_rule end
  )
  select count(*), (select jsonb_agg(to_jsonb(x)) from (select * from off_rule limit 5) x) into v_bad, v_sample from off_rule;
  if v_bad > 0 then
    n := n + public.mon_raise('P1', 'cheap_yearly_rent_served', 'search_index', 'cheap_yearly_rent_served',
      jsonb_build_object(
        'rows', v_bad, 'sample', v_sample,
        'why', 'For a served rent row, search_listings_ar.price_annual must equal rent_price_annual_ar(platform, the site''s period word, the published figure, the type) — the cheap-«yearly» ×12 rule (owner 2026-10-26) — or NULL where the price box holds the per-metre rate (enforce_price_size_sanity, box_is_rate). A row off the rule means sync_search_listings_ar() no longer writes price_annual through the function, a sync has not run since the flag/rule changed, or something writes the index around the sync.',
        'action', 'Read the sample (served vs per_rule); confirm sync_search_listings_ar() contains public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type); run the sync. Never clear this by changing the threshold or the type list on one side only.'));
  else
    perform public.mon_resolve_key('cheap_yearly_rent_served', 'cheap_yearly_rent_served');
  end if;
  return n;
end $function$;
