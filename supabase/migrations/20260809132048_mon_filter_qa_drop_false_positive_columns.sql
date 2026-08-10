-- Reduce mon_filter_qa to the two GENUINE Filter-QA invariants (DROP+CREATE: can't drop view columns
-- in place). Dropped columns and why:
--   • buy_token_price_servable — sub-1000 Buy prices are SOURCE-REAL (PR#362, 204/204 live-verified);
--     asserting it=0 was the wrong premise that led me to null real prices. Magnitude detection, if
--     wanted, is PR#362's mon_detect_price_magnitude_gate.
--   • period_payment_mismatch — flagged the owner's DELIBERATE rent-now-pay-later exclusion
--     (migration 20260719120000) as a bug. False positive (aqar 23235 is RNPL, correctly non-monthly).
-- Kept: cityid_not_in_match (Taif↔Makkah compound-label) + untaxonomized_type (reachability).
drop view if exists public.mon_filter_qa;
create view public.mon_filter_qa as
select
  (select count(*) from search_listings_ar
     where production_ready and city_id is not null
       and coalesce(cardinality(match_city_ids),0)>0
       and not (city_id = any(match_city_ids))) as cityid_not_in_match,
  (select count(*) from search_listings_ar s
     where production_ready
       and not exists (select 1 from known_type_ar k where k.type_ar = s.type_ar)) as untaxonomized_type;
