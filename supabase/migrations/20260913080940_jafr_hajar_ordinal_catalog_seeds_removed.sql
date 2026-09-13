-- Companion to amlakalahsa_jafr_dahiya_districts_merged_to_one: these 12 curated catalog seed rows
-- ("حي هجر الأول".."حي هجر الثاني عشر", city_id 2764 / الجفر) are the pre-existing "well-known name"
-- entries for the exact same numbered sub-divisions that migration just merged under one live
-- district ("الضاحية"). Left in place, they'd linger in the "أي حي؟" dropdown as zero-listing
-- ghost entries (loc_catalog_district rows always surface regardless of live count) — the opposite
-- of the owner's "one simple district" instruction. Removed as a set; the umbrella "الضاحية" entry
-- is populated purely from live data (no catalog seed needed) once refresh_loc_canonical_district()
-- next runs.
delete from public.loc_catalog_district
where city_id = 2764 and district_ar in (
  'حي هجر الأول','حي هجر الثاني','حي هجر الثالث','حي هجر الرابع','حي هجر الخامس','حي هجر السادس',
  'حي هجر السابع','حي هجر الثامن','حي هجر التاسع','حي هجر العاشر','حي هجر الحادي عشر','حي هجر الثاني عشر'
);