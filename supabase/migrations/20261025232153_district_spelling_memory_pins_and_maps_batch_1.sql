-- Near-twin districts decided by PLACE (owner 2026-10-25: «check them in Apple Maps or Google Maps; same place close by =
-- one, if not separate»). For each pair the centers of the homes served under both spellings were compared and Apple Maps
-- was asked which district sits at each center. ONE = under 1.5 km apart AND Apple names the same district at both.
-- 9 pairs are one district: the site spelling folds onto our list name through the spelling memory (the strong guard had
-- refused these as one-letter copies, which is exactly what they are). 14 pairs are two districts and stay apart
-- («البوادر» / «البوادي» are 56 km apart in جدة; Apple names «حي البوادر» there, so it joins the list by the owner's named
-- exception). 7 pairs had no pins on one side and wait for Google Maps / the owner.
do $alias$
declare bad text;
begin
  insert into public.loc_district_alias (city_id, from_norm, to_norm, why, decided_by)
  select v.city_id, public.norm_district_tok(v.site_spelling), public.norm_district_tok(v.our_district), v.why, 'owner'
  from (values
    (3, 'المعيزيلة', 'حي المعيزلة', 'owner 2026-10-25: homes 180 m apart, Apple Maps names المعيزلة at both centers (652 ads)'),
    (3, 'حي العريجاء الغربية', 'حي العريجاء الغربي', 'owner 2026-10-25: homes 110 m apart, Apple Maps names العريجاء الغربي at both centers (524 ads)'),
    (18, 'حي القرينة', 'حي القرينية', 'owner 2026-10-25: homes 650 m apart, Apple Maps names القرينية at both centers (129 ads); both were on our list, القرينية is the name the map uses'),
    (18, 'البغددية الشرقية', 'حي البغدادية الشرقية', 'owner 2026-10-25: homes 340 m apart, Apple Maps names البغدادية الشرقية at both centers (10 ads)'),
    (11, 'حي الوسيطى', 'حي الوسيطا', 'owner 2026-10-25: homes 810 m apart, Apple Maps names الوسيطا at both centers (50 ads)'),
    (1801, 'الحبلة الغربي', 'حي الحيلة الغربي', 'owner 2026-10-25: homes 60 m apart, Apple Maps names الحيلة الغربي at both centers (4 ads)'),
    (3347, 'الروضة الشمالي', 'حي الروضة الشمالية', 'owner 2026-10-25: homes 670 m apart, Apple Maps names الروضة الشمالية at both centers (3 ads)'),
    (664, 'السليمانية', 'حي السلمانية', 'owner 2026-10-25: Apple Maps names السلمانية at the homes center (15 ads)'),
    (3417, 'الجامعة', 'جامعة نجران', 'owner 2026-10-25: homes 1.1 km apart, Apple Maps names جامعة نجران at both centers (7 ads)')
  ) as v(city_id, site_spelling, our_district, why)
  on conflict (city_id, from_norm) do nothing;
  select string_agg(a.city_id || ':' || a.to_norm, ', ') into bad
    from public.loc_district_alias a
   where a.decided_at >= now() - interval '1 minute'
     and not exists (select 1 from public.loc_catalog_district c where c.city_id = a.city_id and c.district_norm = a.to_norm);
  if bad is not null then raise exception 'alias target not in loc_catalog_district: %', bad; end if;
end $alias$;

-- «البوادر» (جدة, 70 ads, far north near ذهبان): a real district 56 km from «البوادي»; the one-letter guard needs the owner's name.
do $add$
begin
  perform set_config('ezhalah.district_guard_ok', 'البوادر', true);
  insert into public.loc_catalog_district (city_id, district_ar) values (18, 'البوادر');
  perform set_config('ezhalah.district_guard_ok', '', true);
end $add$;

-- PROOF
do $proof$
begin
  if public.loc_display_district_ar(3, 'المعيزيلة') <> 'حي المعيزلة' then raise exception 'PROOF: المعيزيلة did not fold'; end if;
  if public.loc_display_district_ar(3, 'حي العريجاء الغربية') <> 'حي العريجاء الغربي' then raise exception 'PROOF: العريجاء الغربية did not fold'; end if;
  if public.loc_display_district_ar(18, 'حي القرينة') <> 'حي القرينية' then raise exception 'PROOF: القرينة did not fold'; end if;
  if public.loc_display_district_ar(3417, 'الجامعة') <> 'جامعة نجران' then raise exception 'PROOF: نجران الجامعة did not fold'; end if;
  if public.loc_display_district_ar(500, 'الجامعة') = 'جامعة نجران' then raise exception 'PROOF: an alias leaked across cities'; end if;
  if not exists (select 1 from public.loc_catalog_district where city_id = 18 and district_ar = 'البوادر') then raise exception 'PROOF: البوادر not on the list'; end if;
  if public.loc_display_district_ar(18, 'البوادر') <> 'البوادر' or public.loc_display_district_ar(18, 'حي البوادي') <> 'حي البوادي' then raise exception 'PROOF: البوادر / البوادي were joined'; end if;
  if public.loc_display_district_ar(3, 'حي المنصورة') = 'حي المنصورية' then raise exception 'PROOF: a SEPARATE pair was joined'; end if;
  raise notice 'PROOF OK: 9 one-district pairs fold to the list name; البوادر on the list; separate pairs untouched';
end $proof$;
