-- "الرياض" (bare, no "حي" prefix) is a real neighborhood inside الهفوف, not the capital city.
-- Proof: (1) loc_catalog_district has "حي الرياض" under الهفوف/جدة/مهد الذهب/البكيرية, but of those
-- only الهفوف is in the Eastern Province — regionally unique for this Eastern-Province-only source;
-- (2) an independent platform (abralosol) has 74 live listings tagged "حي الرياض"/الهفوف, confirming
-- the neighborhood is real and in that city; (3) listings_arabic_locations' own raw-text overlay
-- already independently lands on الهفوف for all 9 of these rows. district_ar is left AS-IS (the
-- office's own text, and the card's neighborhood display) — only city_ar/city_id are filled in,
-- same district_ar=match / neighborhood=card-text split as every other district fix this batch.
update public.amlakalahsa_residential_listings
set city_ar = 'الهفوف', city_id = 12
where city_ar is null and district_ar = 'الرياض';