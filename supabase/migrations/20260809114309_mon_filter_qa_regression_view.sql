-- Filter QA (2026-08-05) regression monitor. Two light counts over the indexed search table, read
-- nightly by scripts/check_audit_invariants.py::check_filter_qa. Both must be 0. Applied as 20260809114309.
create or replace view public.mon_filter_qa as
select
  (select count(*) from public.search_listings_ar
     where production_ready and deal_ar='بيع' and price_total > 0 and price_total < 1000) as buy_token_price_servable,
  (select count(*) from public.search_listings_ar
     where production_ready and city_id is not null and coalesce(cardinality(match_city_ids),0) > 0
       and not (city_id = any(match_city_ids))) as cityid_not_in_match;
