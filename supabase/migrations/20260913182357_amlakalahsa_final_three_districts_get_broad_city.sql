-- Owner instruction 2026-09-13: the last 3 unresolved districts (النور، العقير، الجرن — no
-- confident match to a SPECIFIC city anywhere in the fleet, unlike the 10 resolved in the
-- previous migration) get the broad "الأحساء" city (the real governorate-level catalog entry,
-- city_id 3677, region 5) rather than staying with no city at all. district_ar is deliberately
-- LEFT AS-IS — owner explicit: "under city districts, we guess we don't know, we just leave it" —
-- only the city gets the honest broad-but-true answer; the district stays whatever it already was,
-- never guessed at a finer grain than we can actually prove.
update public.amlakalahsa_residential_listings
set city_ar = 'الاحساء', city_id = 3677
where city_ar is null and district_ar in ('النور', 'العقير', 'الجرن');