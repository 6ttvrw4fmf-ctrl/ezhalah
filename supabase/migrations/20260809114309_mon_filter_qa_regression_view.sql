-- Filter QA (2026-08-05) regression monitor. Two light counts over the indexed search table, read
-- nightly by scripts/check_audit_invariants.py::check_filter_qa. Both must be 0.
--  buy_token_price_servable: servable Buy rows with an impossible sub-1000 price (parse-artifact
--    token) — guards null_impossible_sub1000_buy_price_not_hide.
--  cityid_not_in_match: production_ready rows whose city_id is not in their own authoritative
--    match_city_ids (the Taif→Makkah compound-label class) — guards
--    reconcile_cityid_to_unambiguous_match_city_ids.
create or replace view public.mon_filter_qa as
select
  (select count(*) from public.search_listings_ar
     where production_ready and deal_ar='بيع' and price_total > 0 and price_total < 1000) as buy_token_price_servable,
  (select count(*) from public.search_listings_ar
     where production_ready and city_id is not null and coalesce(cardinality(match_city_ids),0) > 0
       and not (city_id = any(match_city_ids))) as cityid_not_in_match;
