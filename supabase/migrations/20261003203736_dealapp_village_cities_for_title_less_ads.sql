-- Five villages Dealapp's page names when its title names no city (🆕 New Listings Engineer, 2026-10-03).
-- Owner: «they have» a place and a district; «let's not invent, make them searchable by city».
-- Each is a city our catalog ALREADY holds, unique inside the one region given here, so the existing
-- english-city overlay (resolve_english_city_overlay: unique city inside the published region, or nothing)
-- pins it. A village whose name exists in several regions (القويعية ×4) or that the catalog does not hold
-- (الصقيع, الكهفة, الحناه, السقيد, آل ابوسالم) is NOT added: no region is ever guessed. العيينة is left
-- out on purpose (the 2026-08 fallback says Diriyah, one 2026-10-03 ad sits in Tabuk).
-- The English keys are what scrapers/dealapp/run.py LINE_PLACE_CITY_AR emits.
-- فرسان exists in the catalog under both Asir (1675) and Jazan (3571); the Farasan Islands are in Jazan,
-- and the region in this row is what selects between the two.
set local statement_timeout = '1min';
set local lock_timeout = '5s';
insert into public.loc_city_map (city_key, city_ar, region_ar)
select v.city_key, v.city_ar, v.region_ar
  from (values
    ('halban',         'حلبان',        'منطقة الرياض'),
    ('sanam',          'سنام',         'منطقة الرياض'),
    ('tuhayy',         'طحي',          'منطقة الرياض'),
    ('bir bin hirmas', 'بئر بن هرماس', 'منطقة تبوك'),
    ('farasan',        'فرسان',        'منطقة جازان')
  ) as v(city_key, city_ar, region_ar)
 where not exists (select 1 from public.loc_city_map m where m.city_key = v.city_key);

do $verify$
declare k text; n int;
begin
  foreach k in array array['halban','sanam','tuhayy','bir bin hirmas','farasan'] loop
    -- the overlay's own rule: exactly one catalog city for this key inside its region
    select count(distinct cc.city_id) into n
      from public.loc_city_map cm
      join public.loc_catalog_region cr on cr.region_ar = cm.region_ar
      join public.loc_catalog_city cc on cc.region_id = cr.region_id
           and normalize_ar(cc.city_ar) = normalize_ar(cm.city_ar)
     where cm.city_key = k;
    if n <> 1 then
      raise exception 'loc_city_map key % resolves to % catalog cities, expected exactly 1', k, n;
    end if;
  end loop;
end
$verify$;
