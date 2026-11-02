-- abaad files two listings under a «city - district» composite in its city field, the same shape as
-- the «ابو عريش - ابو عريش» / «صامطه - القفل» aliases already here. Measured 2026-10-25: every raw city
-- label of abaad (470 ads), reinvest (915) and eilmalriyada (284) run through the real to_catalog():
-- 9 + 17 + 13 skip city_not_in_catalog, matching each site's own run notes. Only these two name ONE
-- catalogue city, and abaad's own region field (zone_name_ar) corroborates it:
--   «المجاردة - الخوش» ×1 (zone عسير)  → المجاردة (منطقة عسير)
--   «جازان - الغريف»  ×1 (zone جازان)  → جازان   (منطقة جازان)
-- The second half is a district word; it is NOT resolved here (never guess a district).
-- NOT aliased, on purpose: «قريه ديراب» ×9 (ديراب is a Riyadh-city DISTRICT, so filing it needs a
-- district guess — owner question), «القصيم» ×11 (a region), «القويعية» / «محافظة تربة» (several
-- catalogue cities share the name and the site gives no region), and farm / village / plot labels
-- that are not catalogue cities. Reversible: delete these two alias rows.
insert into public.loc_catalog_city_alias (alias_norm, city_id)
select public.normalize_ar(a.alias), c.city_id
  from (values
    ('المجاردة - الخوش', 'المجاردة', 'منطقة عسير'),
    ('جازان - الغريف', 'جازان', 'منطقة جازان')
  ) as a(alias, city_ar, region_ar)
  join public.loc_catalog_city c on c.city_norm = public.normalize_ar(a.city_ar)
  join public.loc_catalog_region r on r.region_id = c.region_id and r.region_ar = a.region_ar
on conflict (alias_norm) do nothing;

do $do$
begin
  if (select count(*) from public.loc_catalog_city_alias x
        join public.loc_catalog_city c on c.city_id = x.city_id
       where (x.alias_norm, c.city_norm) in (
         (public.normalize_ar('المجاردة - الخوش'), public.normalize_ar('المجاردة')),
         (public.normalize_ar('جازان - الغريف'), public.normalize_ar('جازان')))
     ) <> 2 then
    raise exception 'ABORT: expected 2 abaad composite aliases, each on its own catalogue city';
  end if;
end $do$;
