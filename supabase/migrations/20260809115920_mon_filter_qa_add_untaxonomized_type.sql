-- Filter QA (2026-08-05): add the untaxonomized-type reachability count to the regression monitor.
create or replace view public.mon_filter_qa as
select
  (select count(*) from public.search_listings_ar
     where production_ready and deal_ar='بيع' and price_total > 0 and price_total < 1000) as buy_token_price_servable,
  (select count(*) from public.search_listings_ar
     where production_ready and city_id is not null and coalesce(cardinality(match_city_ids),0) > 0
       and not (city_id = any(match_city_ids))) as cityid_not_in_match,
  (select count(*) from public.search_listings_ar s
     where production_ready and not exists (select 1 from public.known_type_ar k where k.type_ar = s.type_ar)) as untaxonomized_type;
