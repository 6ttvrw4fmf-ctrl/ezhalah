-- Owner instruction 2026-09-13: amlakalahsa's الجفر listings publish their own sub-division as
-- numbered "الضاحية <ordinal>" (1st/2nd/3rd/.../10th, + one named "التعاون" slice) — 9 distinct
-- values, 32 listings, all genuinely the same physical development ("ضاحية هجر"), just numbered
-- sub-plots within it. Owner: don't make a buyer pick a specific number they don't know — merge
-- them all under one district, "الضاحية", for MATCHING purposes only.
--
-- Only district_ar (the match-truth column) is touched — neighborhood (the card's own display
-- text) is left untouched, so every card still shows its own real sub-division name verbatim
-- ("الضاحية الخامس", etc.), per this repo's standing district_ar=match / neighborhood=card-text
-- split. This is a rename to a single shared value, not a guess: "الضاحية" is the office's own
-- word for the parent development, just without a sub-number attached.
update public.amlakalahsa_residential_listings
set district_ar = 'الضاحية'
where city_ar = 'الجفر' and district_ar like 'الضاحية%';