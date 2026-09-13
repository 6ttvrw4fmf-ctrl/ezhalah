-- Last numbered district anywhere in the Al-Ahsa cities: المنيزلة "الريف 2" (one amlakalahsa
-- listing). Same treatment as the الاحساء batch — the office's own name with the sub-plot number
-- dropped. "الريف" is a real district name; the card still shows "الريف 2" exactly as published.
insert into public.loc_district_number_override (city_id, district_norm, display_ar, why)
select c.city_id, norm_district_tok('الريف 2'), 'الريف',
       'sub-plot number on the office''s own name; the card keeps "الريف 2" verbatim'
  from public.loc_catalog_city c
 where c.city_ar = 'المنيزلة'
on conflict (city_id, district_norm) do update
  set display_ar = excluded.display_ar, why = excluded.why;