-- Filter QA (2026-08-05). Add period_payment_mismatch to the serving-layer regression monitor.
-- All four counts MUST read 0; check_audit_invariants.py::check_filter_qa asserts it nightly.
create or replace view public.mon_filter_qa as
select
  (select count(*) from search_listings_ar
     where production_ready and deal_ar='بيع' and price_total between 1 and 999) as buy_token_price_servable,
  (select count(*) from search_listings_ar
     where production_ready and city_id is not null
       and coalesce(cardinality(match_city_ids),0)>0
       and not (city_id = any(match_city_ids))) as cityid_not_in_match,
  (select count(*) from search_listings_ar s
     where production_ready
       and not exists (select 1 from known_type_ar k where k.type_ar = s.type_ar)) as untaxonomized_type,
  (select count(*) from search_listings_ar
     where deal_ar='إيجار'
       and ((rent_period_ar='شهري' and payment_monthly is distinct from true)
         or (rent_period_ar='سنوي' and payment_monthly is distinct from false))) as period_payment_mismatch;
