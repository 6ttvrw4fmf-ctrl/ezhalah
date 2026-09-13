-- Owner-directed 2026-09-13, two parts, both district_ar-only (match-truth column) — neighborhood
-- (the card's own display text) is untouched everywhere here, so every card keeps showing the
-- office's own exact wording.
--
-- PART 1 — 10 "no city" rows, each independently proven via other listings (same exact district
-- text already resolved to a city elsewhere, on this platform or others) or via the district's own
-- wording naming its city ("الرابية بالعيون"). city_id set explicitly (not just city_ar) — a row is
-- only production_ready with BOTH city_id and region_id populated; region_id is already 5 for every
-- amlakalahsa row (Al-Ahsa-only office, per the original scraper decision).
update public.amlakalahsa_residential_listings
set city_ar = 'الهفوف', city_id = 12
where city_ar is null and district_ar in ('شرق شرق الحديقة', 'اليمامة', 'الطرف');

update public.amlakalahsa_residential_listings
set city_ar = 'المبرز', city_id = 2748
where city_ar is null and district_ar in ('بستان المطيرفي', 'الجابرية');

update public.amlakalahsa_residential_listings
set city_ar = 'الحليلة', city_id = 2762
where city_ar is null and district_ar = 'البستنان';

update public.amlakalahsa_residential_listings
set city_ar = 'العيون', city_id = 2038
where city_ar is null and district_ar = 'الرابية بالعيون';

-- الصفا 2 / الصفا (bare) both proven -> العيون by amlakalahsa's own other rows there.
-- Owner instruction: a numbered variant matches to its bare name — card keeps the number
-- (neighborhood untouched), district_ar (match-truth) drops it.
update public.amlakalahsa_residential_listings
set city_ar = 'العيون', city_id = 2038, district_ar = 'الصفا'
where city_ar is null and district_ar = 'الصفا 2';

update public.amlakalahsa_residential_listings
set city_ar = 'العيون', city_id = 2038
where city_ar is null and district_ar = 'الصفا';

update public.amlakalahsa_residential_listings
set city_ar = 'المبرز', city_id = 2748, district_ar = 'الغسانية'
where city_ar is null and district_ar = 'الغسانية';

-- PART 2 — same numbered-variant-matches-its-bare-name rule, for rows that ALREADY have a city
-- (no city fix needed, just the district_ar merge). Card text (neighborhood) untouched.
update public.amlakalahsa_residential_listings
set district_ar = 'النسيم'
where city_ar = 'الهفوف' and district_ar in ('النسيم 2', 'النسيم 3');

update public.amlakalahsa_residential_listings
set district_ar = 'المزروع'
where city_ar = 'الهفوف' and district_ar = 'المزروع 2';

update public.amlakalahsa_residential_listings
set district_ar = 'المباركية'
where city_ar = 'الهفوف' and district_ar = 'المباركية 3';

update public.amlakalahsa_residential_listings
set district_ar = 'الغسانية'
where city_ar = 'المبرز' and district_ar = 'الغسانية 2';