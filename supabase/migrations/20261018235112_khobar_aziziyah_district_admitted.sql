-- 2026-10-18, owner decision relayed by the coordinator: «العزيزية» is a real district of الخبر (city_id 31) and the
-- catalogue lacked it. Source-attested before this: 11 served ads in الخبر carry it as their own district word
-- (albukaeri, aouj, arsh, hazim, ialqarawi, ksaaqar, rightcompound), and rightcompound's own JSON-LD addresses say
-- «Aziziyah, Khobar» / «Aziziyah district» on 14 units (gulf-pearl-compound-2, sea-shore-compound,
-- black-pearl-residential-compound, al-nawras-residential-compound). City-scoped: the Eastern Province's other
-- «العزيزية» (الدمام, الجبيل, حفر الباطن, الخفجي, …) are separate districts of their own cities and are not touched;
-- «غرب العزيزية» (الخبر, 21 ads) stays its own name.
set local lock_timeout = '5s';

insert into public.loc_catalog_district (city_id, district_ar, district_norm)
values (31, 'حي العزيزية', public.norm_district_tok('حي العزيزية'))
on conflict (city_id, district_norm) do nothing;

do $$
begin
  if (select count(*) from public.loc_catalog_district
       where district_norm = public.norm_district_tok('حي العزيزية') and city_id = 31) <> 1 then
    raise exception 'الخبر «العزيزية» was not admitted exactly once';
  end if;
  if exists (select 1 from public.loc_catalog_city where city_id = 31 and city_ar <> 'الخبر') then
    raise exception 'city_id 31 is not الخبر — refusing to admit the district to the wrong city';
  end if;
end $$;
