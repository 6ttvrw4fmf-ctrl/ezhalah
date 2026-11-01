-- QA & Repair 2026-10-07: seven Unaizah (عنيزة, city_id 80) districts that the source states as «حي X بعنيزة»
-- but loc_catalog_district lacked, so ialqarawi's resolver (find_district_in_text: exact catalog match only,
-- never invents) left 55 searchable listings with no district — a customer picking the district never found them.
-- Evidence, active ialqarawi ads whose «الحي» field AND title name the district («بحي X بعنيزة»), ≥ 2 each:
--   الياسمين 9 of 17 · المنح 13 of 13 · سمحة 6 of 7 · الجال الشرقي 5 of 5 · المزادة 4 of 4 · السفيلا 3 of 4 ·
--   الغوطة 2 of 5 (e.g. ids 12589906, 12592943). Excluded on purpose: الجوز (1 «حي», 3 «مخطط» — a plan),
--   الراحة / الفيضه (catalog CITY names, which the scraper deliberately never reads as a district),
--   القدس / الورود (common street names: a title fallback could mis-read «طريق القدس»), every «مخطط …» and the
--   directional «غرب/وسط/جنوب عنيزة». No listing row is written here: the daily ialqarawi crawl (~04:25 UTC)
--   re-upserts every row through the sanctioned resolver, which now finds these, and the 05:22 sync serves them.
insert into public.loc_catalog_district (city_id, district_ar, district_norm)
select v.city_id, v.district_ar, public.norm_district_tok(v.district_ar)
from (values
    (80, 'حي الياسمين'),
    (80, 'حي المنح'),
    (80, 'حي سمحة'),
    (80, 'حي الجال الشرقي'),
    (80, 'حي المزادة'),
    (80, 'حي السفيلا'),
    (80, 'حي الغوطة')
) as v(city_id, district_ar)
on conflict (city_id, district_norm) do nothing;
