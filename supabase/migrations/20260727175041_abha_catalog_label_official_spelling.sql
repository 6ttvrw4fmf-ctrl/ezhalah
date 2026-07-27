-- Audit item 7g: canonical catalog label for Abha (city_id 15) uses the official
-- hamza spelling «أبها» (matches the app's own cityDisplay/translit maps and REGA usage).
-- Label-only: city_norm is unchanged (normalize_ar strips hamza, so both typed spellings
-- already resolve identically — verified 3,223 = 3,223 via anon REST pre-change).
-- Listing rows' city_ar stays faithful source text per the listing-fidelity rule.
update loc_catalog_city set city_ar = 'أبها' where city_id = 15 and city_ar = 'ابها';
