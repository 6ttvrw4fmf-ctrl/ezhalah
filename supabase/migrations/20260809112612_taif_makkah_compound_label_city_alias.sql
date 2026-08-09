-- Filter QA (2026-08-05). Durable alias for the recurring Taif→Makkah leak. The compound REGA label
-- "امارة منطقة مكة المكرمة - الطائف" (Makkah-REGION prefix + the ACTUAL city الطائف) resolved to the
-- region capital مكة المكرمة (city_id 6) instead of الطائف (5). Adds the exact source→canonical alias
-- (no Region→City→District architecture change). Applied to prod as 20260809112612.
insert into public.loc_catalog_city_alias (alias_norm, city_id)
values (public.normalize_ar('امارة منطقة مكة المكرمة - الطائف'), 5)
on conflict (alias_norm) do update set city_id = excluded.city_id;
