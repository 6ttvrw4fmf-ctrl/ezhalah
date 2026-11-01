-- APPLIED 2026-10-18 06:55:29 UTC (owner session).
-- Owner decision 2026-10-17 («sure do that»): «حي الفرسان» is an عنيزة district (52 ialqarawi ads name it in their
-- own «الحي» field and titles «بحي الفرسان بعنيزة»). It was held back only because norm_district_tok folds it onto
-- the town «فرسان» (Farasan island, جازان) — a different place 900 km away; the district is city-scoped to عنيزة.
delete from public.ops_district_name_decision
 where city_id = 80 and name_norm = public.norm_district_tok('الفرسان');

insert into public.loc_catalog_district (city_id, district_ar, district_norm)
values (80, 'حي الفرسان', public.norm_district_tok('حي الفرسان'))
on conflict (city_id, district_norm) do nothing;
