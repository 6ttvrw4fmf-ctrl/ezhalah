-- The home headline's lines, v3 (owner 2026-10-22). Three decisions, all the owner's:
--   • prices are the displayed ASKING price: «السعر المعروض» / «الإيجار السنوي المعروض» («we never recommend»);
--   • the weak lines go («pointless»): pool counts, website counts, maid rooms, one-ad towns, plus «أقل إيجار»
--     (lowest across every source cannot be proven) and «مكاتب عقارية محلية» (a judgement, not a count);
--   • no regions — a line names a CITY, then its busiest DISTRICT («don't talk region, talk city then district»),
--     and investors' volume: new listings by type and area, and this week against last week.
-- Every count is phrased so it is correct Arabic for any number («{a} من الشقق الجديدة»).
set local statement_timeout = '2min';

insert into public.welcome_template(id, kind, personal, ar, en) values
 (6,  'land_ppm_city',   false, '{g} {n}، تدري إن متوسط السعر المعروض لمتر الأرض في {city} {a} ريال؟ اكتشف أراضيها مع إزهله.', '{g} {n}, did you know the median asking price for land in {city} is {a} SAR per m²? Discover its land with Ezhalah.'),
 (8,  'land_gap',        false, '{g} {n}، تدري إن متوسط السعر المعروض لمتر الأرض في {district} ب{city} {a} ريال، بينما في {district2} {b} ريال؟ اكتشف الفرق مع إزهله.', '{g} {n}, did you know the median asking land price in {district}, {city} is {a} SAR per m², while in {district2} it is {b} SAR? Discover the difference with Ezhalah.'),
 (10, 'rent_apt',        false, '{g} {n}، تدري إن متوسط الإيجار السنوي المعروض للشقق في {district} ب{city} {a} ريال؟ اكتشفها مع إزهله.', '{g} {n}, did you know the median asking annual rent for apartments in {district}, {city} is {a} SAR? Discover them with Ezhalah.'),
 (11, 'rent_gap',        false, '{g} {n}، تدري إن متوسط الإيجار السنوي المعروض للشقق في {district} ب{city} {a} ريال، بينما في {district2} {b} ريال؟ اكتشف الفرق مع إزهله.', '{g} {n}, did you know the median asking annual apartment rent in {district}, {city} is {a} SAR, while in {district2} it is {b} SAR? Discover the difference with Ezhalah.'),
 (16, 'villa_ppm',       false, '{g} {n}، تدري إن متوسط السعر المعروض لمتر الفلل في {district} ب{city} {a} ريال؟ اكتشفها مع إزهله.', '{g} {n}, did you know the median asking villa price in {district}, {city} is {a} SAR per m²? Discover them with Ezhalah.'),
 (20, 'shop_rent',       false, '{g} {n}، تدري إن متوسط الإيجار السنوي المعروض للمحلات في {district} ب{city} {a} ريال؟ اكتشفها مع إزهله.', '{g} {n}, did you know the median asking annual rent for shops in {district}, {city} is {a} SAR? Discover them with Ezhalah.'),
 (23, 'yesterday',       false, '{g} {n}، تدري إن عدد الإعلانات الجديدة في المملكة أمس بلغ {a}، منها {b} في {city}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a} new listings were added across the Kingdom yesterday, {b} of them in {city}? Discover them with Ezhalah.'),
 (31, 'city_week',       false, '{g} {n}، تدري إن {city} أُضيف فيها هذا الأسبوع {a} من الإعلانات الجديدة، أكثرها في {district}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} got {a} new listings this week, most of them in {district}? Discover them with Ezhalah.'),
 (32, 'city_land',       false, '{g} {n}، تدري إن عدد الأراضي المعروضة في {city} {a}، أكثرها في {district}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} has {a} plots of land on offer, most of them in {district}? Discover them with Ezhalah.'),
 (33, 'week_land',       false, '{g} {n}، تدري إن {city} أُضيف فيها هذا الأسبوع {a} من الأراضي الجديدة للبيع، أكثرها في {district}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} got {a} new plots of land for sale this week, most of them in {district}? Discover them with Ezhalah.'),
 (34, 'week_apt_rent',   false, '{g} {n}، تدري إن {city} أُضيف فيها هذا الأسبوع {a} من الشقق الجديدة للإيجار، أكثرها في {district}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} got {a} new apartments for rent this week, most of them in {district}? Discover them with Ezhalah.'),
 (35, 'week_villa_sale', false, '{g} {n}، تدري إن {city} أُضيف فيها هذا الأسبوع {a} من الفلل الجديدة للبيع، أكثرها في {district}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} got {a} new villas for sale this week, most of them in {district}? Discover them with Ezhalah.'),
 (36, 'wow_apt_rent_up', false, '{g} {n}، تدري إن إعلانات الشقق الجديدة للإيجار في {city} زادت هذا الأسبوع {a}% عن الأسبوع الماضي؟ اكتشفها مع إزهله.', '{g} {n}, did you know new apartment-for-rent listings in {city} rose {a}% this week compared with last week? Discover them with Ezhalah.'),
 (37, 'wow_apt_rent_down', false, '{g} {n}، تدري إن إعلانات الشقق الجديدة للإيجار في {city} قلّت هذا الأسبوع {a}% عن الأسبوع الماضي؟ اكتشفها مع إزهله.', '{g} {n}, did you know new apartment-for-rent listings in {city} fell {a}% this week compared with last week? Discover them with Ezhalah.'),
 (38, 'wow_land_up',     false, '{g} {n}، تدري إن إعلانات الأراضي الجديدة للبيع في {city} زادت هذا الأسبوع {a}% عن الأسبوع الماضي؟ اكتشفها مع إزهله.', '{g} {n}, did you know new land-for-sale listings in {city} rose {a}% this week compared with last week? Discover them with Ezhalah.'),
 (39, 'wow_land_down',   false, '{g} {n}، تدري إن إعلانات الأراضي الجديدة للبيع في {city} قلّت هذا الأسبوع {a}% عن الأسبوع الماضي؟ اكتشفها مع إزهله.', '{g} {n}, did you know new land-for-sale listings in {city} fell {a}% this week compared with last week? Discover them with Ezhalah.'),
 (40, 'wow_villa_up',    false, '{g} {n}، تدري إن إعلانات الفلل الجديدة للبيع في {city} زادت هذا الأسبوع {a}% عن الأسبوع الماضي؟ اكتشفها مع إزهله.', '{g} {n}, did you know new villa-for-sale listings in {city} rose {a}% this week compared with last week? Discover them with Ezhalah.'),
 (41, 'wow_villa_down',  false, '{g} {n}، تدري إن إعلانات الفلل الجديدة للبيع في {city} قلّت هذا الأسبوع {a}% عن الأسبوع الماضي؟ اكتشفها مع إزهله.', '{g} {n}, did you know new villa-for-sale listings in {city} fell {a}% this week compared with last week? Discover them with Ezhalah.')
on conflict (id) do update set kind = excluded.kind, personal = excluded.personal, ar = excluded.ar, en = excluded.en, active = true;

-- retired: town_few, town_single, region_week, region_land, maid, pool, local_office, district_sites, region_sites, min_rent_apt
update public.welcome_template set active = false where id in (1, 2, 5, 9, 17, 18, 25, 26, 27, 29);

do $proof$
begin
  if (select count(*) from public.welcome_template where active) <> 30 then
    raise exception 'PROOF: % active lines, expected 30', (select count(*) from public.welcome_template where active);
  end if;
  if exists (select 1 from public.welcome_template where active and (ar like '%{region}%' or en like '%{region}%')) then
    raise exception 'PROOF: an active line still names a region';
  end if;
  if exists (select 1 from public.welcome_template where active and ar ~ 'متوسط (سعر|الإيجار السنوي) (متر|لل)') then
    raise exception 'PROOF: a price line does not say «المعروض»';
  end if;
end $proof$;
