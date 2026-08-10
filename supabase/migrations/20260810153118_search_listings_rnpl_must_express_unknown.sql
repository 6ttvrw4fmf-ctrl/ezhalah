-- search_listings_ar.rent_now_pay_later was NOT NULL DEFAULT false.
--
-- This is the deepest layer of the manufactured-negative defect: the column was
-- structurally incapable of expressing "the source never said". Every listing
-- from the 33 platforms that publish nothing about instalments was forced to
-- assert "does NOT offer instalments".
--
-- rent_now_pay_later is a SOURCE ATTRIBUTE and must be tri-state (true/false/NULL).
-- Contrast production_ready and payment_monthly, which are derived SYSTEM routing
-- flags - those stay NOT NULL DEFAULT false deliberately and are untouched here.
--
-- Behaviour-identical: every consumer already collapses NULL to false --
--   location_search_candidates_ar routing : coalesce(s.rent_now_pay_later, false)
--   location_search_candidates_ar amenity : `or s.rent_now_pay_later`
--   sync_payment_monthly / enforce_price_size_sanity : not coalesce(..., false)
alter table public.search_listings_ar alter column rent_now_pay_later drop not null;
alter table public.search_listings_ar alter column rent_now_pay_later drop default;

comment on column public.search_listings_ar.rent_now_pay_later is
  'Tri-state source attribute: true = the source published an instalment/RNPL offer, false = the source published a negative, NULL = the source said nothing. NEVER coalesce silence to false on write.';
