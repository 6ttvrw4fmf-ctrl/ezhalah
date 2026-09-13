-- Owner directly confirmed 2026-09-13 ("it's its own city"): bare district_ar='الجشة' with no city
-- means the الجشة catalog city itself (city_id 2746, already a real pre-existing catalog entry —
-- not invented). Confirmed non-ambiguous: normalize_ar('الجشة') does not collide with the ONE other
-- catalog hit for that text ("بلدة الجشة" under الجفر, which normalizes differently). The listing's
-- own description ("بالقرب من حديقة الجشة") reads as being IN the town, not a neighborhood of it.
update public.amlakalahsa_residential_listings
set city_ar = 'الجشة', city_id = 2746
where city_ar is null and district_ar = 'الجشة';

-- Owner asked to re-check listing 11606266 (district_ar='المروج', no city). Bare "المروج" is
-- genuinely ambiguous fleet-wide (~40 Saudi cities have a "حي المروج") so it was correctly left
-- alone before — but THIS listing's own raw description and URL slug both independently say
-- "حي المروج الجنوبي" in full ("للبيع أرض في حي المروج الجنوبي أرض رقم 46..."), a real catalog
-- district that exists ONLY under الهفوف. The office's structured district field just truncated the
-- "الجنوبي" qualifier that its own free text preserves. This is a one-listing fact (proven by that
-- listing's own text), not a "bare المروج means الهفوف" pattern — id-scoped on purpose, so it never
-- touches any other, genuinely-unrelated "المروج" listing elsewhere in the fleet.
update public.amlakalahsa_residential_listings
set city_ar = 'الهفوف', city_id = 12
where id = 11606266;