-- ksaaqar: blank EVERY price. Not a subset — every one of them is unverifiable.
--
-- WHAT HAPPENED. scrapers/ksaaqar/run.py::parse_price searched the whole flattened detail page for
-- the first «…SAR» string. Every ksaaqar detail page renders a STATIC sidebar of five unrelated
-- ads (`.price-box`) that is byte-identical on every page of the site, and — this is the part that
-- made it total rather than occasional — the ad's OWN price renders in Arabic as «3,200.00ريال»,
-- which the SAR-only regex never matched. So the parser could not read a real price even in
-- principle. Verified 2026-09-19 against four live pages:
--
--   ad                              stored      actually published
--   أراضي للبيع                     13,370      3,200.00ريال
--   ارض للبيع-8                     13,370      10,000,000.00ريال
--   أراضي جنوب الرياض               13,370      280.00ريال
--   ارض كبيرة بمنطقة مستودعات       13,370      «السعر عند الطلب»  ← no price exists at all
--
-- The fingerprint in the data was a distribution no real market produces: 685 of 720 priced rows
-- shared seven values (13,370 ×159, 250,000 ×231, 50,000 ×182, 15,000,000 ×81). The last row above
-- is the one that matters most — PRICE = SOURCE bans inventing a price, and we invented one for
-- every ad whose seller published none.
--
-- WHY A MIGRATION AND NOT JUST A RE-SWEEP. db's _unknown_must_not_overwrite_known() drops None
-- keys, so a scraper can never RETRACT a value it previously wrote: a re-sweep would correct the
-- ads that do publish a price and leave the fabricated figure standing on every ad that does not.
-- The wrong values have to be cleared here, then refilled by the fixed parser (own_price(), which
-- reads the ad's own share-modal card anchored on the ad's own href).
--
-- Guarded: scoped to the two ksaaqar tables by name, touches only price columns, and leaves
-- price_published in additional_info consistent with the cleared state.

update public.ksaaqar_residential_listings
   set price_total      = null,
       price_annual     = null,
       price_per_meter  = null,
       additional_info  = case
                            when additional_info ? 'price_published'
                              then jsonb_set(additional_info, '{price_published}', 'false'::jsonb)
                            else additional_info
                          end
 where price_total is not null
    or price_annual is not null
    or price_per_meter is not null
    or additional_info -> 'price_published' = 'true'::jsonb;

update public.ksaaqar_commercial_listings
   set price_total      = null,
       price_annual     = null,
       price_per_meter  = null,
       additional_info  = case
                            when additional_info ? 'price_published'
                              then jsonb_set(additional_info, '{price_published}', 'false'::jsonb)
                            else additional_info
                          end
 where price_total is not null
    or price_annual is not null
    or price_per_meter is not null
    or additional_info -> 'price_published' = 'true'::jsonb;
