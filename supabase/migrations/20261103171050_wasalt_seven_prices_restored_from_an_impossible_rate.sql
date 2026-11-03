-- Seven wasalt sale ads served with NO price (2026-11-03). wasalt_rate_is_not_the_total() had moved each real total into
-- price_per_meter (5,936,000 … 8,880,000 «SAR/m²») and NULLed price_total, because a stale archived description total
-- equalled total × area. Read live from wasalt.sa/en/property/x-<id> the same day: salePrice equals the parked figure
-- and wasalt's own averageSalePricePerSqm is a real rate (4,400-10,000 SAR/m²). The trigger no longer treats a
-- > 2,000,000 SAR/m² figure as a rate (companion migration); these rows get their price back, guarded on their current
-- shape. Watched by mon_detect_field_integrity and mon_detect_served_total_below_city_floor.
update public.wasalt_residential_listings set price_total = 5936000, price_per_meter = null where id = 16532216 and price_total is null and price_per_meter = 5936000;
update public.wasalt_residential_listings set price_total = 6650000, price_per_meter = null where id = 15940324 and price_total is null and price_per_meter = 6650000;
update public.wasalt_residential_listings set price_total = 2750000, price_per_meter = null where id = 14700498 and price_total is null and price_per_meter = 2750000;
update public.wasalt_residential_listings set price_total = 4500000, price_per_meter = null where id = 15925545 and price_total is null and price_per_meter = 4500000;
update public.wasalt_residential_listings set price_total = 2715000, price_per_meter = null where id = 15925549 and price_total is null and price_per_meter = 2715000;
update public.wasalt_residential_listings set price_total = 8880000, price_per_meter = null where id = 15940204 and price_total is null and price_per_meter = 8880000;
update public.wasalt_residential_listings set price_total = 4180480, price_per_meter = null where id = 15940205 and price_total is null and price_per_meter = 4180480;