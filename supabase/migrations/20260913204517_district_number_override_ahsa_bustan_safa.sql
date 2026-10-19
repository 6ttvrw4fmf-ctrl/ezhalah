-- Two remaining numbered duplicates in الاحساء. Unlike the first batch these have no clean twin
-- already in the picker, so the override supplies the source's OWN name with the sub-plot marker
-- removed — "البستان1" -> "البستان", "الصفا(2)" -> "الصفا". Both are real, well-known Al-Ahsa
-- district names (الصفا is an official catalog district in العيون), so nothing is invented: the
-- decoration is dropped, the name itself is the office's own word. The property CARD still shows
-- their exact text.
insert into public.loc_district_number_override (city_id, district_norm, display_ar, why) values
  (3677, norm_district_tok('البستان1'), 'البستان', 'sub-plot number on the office''s own name; البستان is a real Al-Ahsa district'),
  (3677, norm_district_tok('الصفا(2)'), 'الصفا',   'sub-plot number in parentheses on the office''s own name; الصفا is a real Al-Ahsa district')
on conflict (city_id, district_norm) do update
  set display_ar = excluded.display_ar, why = excluded.why;