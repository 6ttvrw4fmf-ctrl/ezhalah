-- Bring rent_now_pay_later under the Safety Barrier tripwire.
--
-- Only aqar ever produced rent_now_pay_later = true (19,345 across its inventory).
-- The other 33 platforms held 113,613 `false` cells with ZERO trues anywhere — no
-- scraper ever read the attribute, so every one of those was an invented "no".
-- They are now NULL.
--
-- This change is behaviour-identical by construction: BOTH predicates in
-- location_search_candidates_ar already treat NULL exactly as false —
--   routing : coalesce(s.rent_now_pay_later, false)
--   amenity : `or s.rent_now_pay_later`   (NULL -> NULL -> row excluded)
-- so no result set moves; we simply stop asserting a negative no source stated.
--
-- aqar is deliberately NOT repaired: it produces both polarities, which is the
-- same evidence rule the rest of the barrier uses. Separately noted for follow-up:
-- aqar's `false` derives from the absence of an '/rnpl/' marker rather than from
-- its published accept_monthly / accept_quarterly / accept_semiannually booleans,
-- which we do not yet scrape. Reading those would upgrade aqar from
-- marker-absence to a genuine published negative.
create or replace function public.barrier_attribute_columns()
returns text[] language sql immutable as $$
  select array[
    'elevator','parking','kitchen','air_conditioner','maid_room','driver_room',
    'private_entrance','balcony_terrace','laundry_room','optical_fibers',
    'separate_water_meter','separate_electricity_meter','car_entrance',
    'water_supply','electricity','sanitation','villa_on_roof',
    'rent_now_pay_later'
  ]::text[];
$$;
