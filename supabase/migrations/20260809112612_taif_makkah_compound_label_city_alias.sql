-- Filter QA (2026-08-05). Durable fix for the recurring Taif→Makkah leak (prior one-off row repair
-- 20260724134922 reverted on the next sync from listing_native_location_v2). The compound REGA label
-- "امارة منطقة مكة المكرمة - الطائف" (Makkah-REGION governorate prefix + the ACTUAL city الطائف) was
-- resolved to the region-capital مكة المكرمة (city_id 6) instead of the trailing city الطائف (5).
-- composite_match_city_ids() already resolves the SAME text to {5}, so this only corrects the
-- separately-stored city_id via the resolver's own alias mechanism (loc_catalog_city_alias) — no
-- Region→City→District architecture change. Reversible: delete this alias row.
insert into public.loc_catalog_city_alias (alias_norm, city_id)
values (public.normalize_ar('امارة منطقة مكة المكرمة - الطائف'), 5)
on conflict (alias_norm) do update set city_id = excluded.city_id;
