-- 🆕 New Listings Engineer 2026-10-24 (contract G, unknown named districts outside Al-Ahsa: 9 names / 39 ads).
-- Admission rule of 20261011133138 / 20261018035154: ≥ 3 distinct active ads name it, not a town in
-- loc_catalog_city, not a plan / direction / number, not a spelling of an existing district of that city,
-- and (🔧 10-10) the ads' own pins sit together inside the city. No listing row is written here: the hourly
-- district recovery (:10) and the next crawl re-resolve through the sanctioned resolver.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (1882, 'حي الفنار'),  -- بحرة المجاهدين: sakan 3 + tuba 3 («فيلا للبيع - بحرة - حي الفنار»), 3 distinct pins within 1 km (21.419–21.428 N, 39.495–39.504 E); the city's only catalog district is حي الاصالة
    (11,   'حي مشعل')     -- بريدة: ashab 4 ads, own district field «مشعل», 3 distinct pins within 1 km (26.3537–26.3602 N, 43.932–43.937 E)
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;

-- Names not admitted, with the why, so the daily alarm does not re-raise them.
insert into public.ops_district_name_decision (city_id, name_norm, decision, why)
select v.city_id, public.norm_district_tok(v.name), 'rejected', v.why
from (values
    (3,    'غصون',          'justsa only (5 ads as «غصون» / «الغصون»), no pin on any of them and no second source names it in الرياض — cannot place it; revisit when a pinned ad or a second site names it'),
    (3,    'الغصون',        'same place as «غصون» above — justsa only, no pin, no second source'),
    (2746, 'البريد بالجشه', 'bossbih 3 ads; the words carry the town («بالجشه» = in الجشة) and no ad has a pin, no second source names «البريد» in الجشة — cannot place it')
) as v(city_id, name, why)
on conflict (city_id, name_norm) do nothing;

do $$
begin
  if (select count(*) from public.loc_catalog_district
       where (city_id, district_norm) in ((1882, public.norm_district_tok('حي الفنار')), (11, public.norm_district_tok('حي مشعل')))) <> 2 then
    raise exception 'district admissions did not land';
  end if;
  if exists (select 1 from public.unknown_named_districts(3) u
              where (u.city_id = 1882 and u.name = 'الفنار') or (u.city_id = 11 and u.name = 'مشعل')
                 or (u.city_id = 3 and u.name = 'غصون') or (u.city_id = 2746 and u.name = 'البريد بالجشه')) then
    raise exception 'unknown_named_districts still lists an admitted or decided name';
  end if;
end $$;