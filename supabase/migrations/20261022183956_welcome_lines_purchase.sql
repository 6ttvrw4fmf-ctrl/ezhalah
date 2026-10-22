-- The home headline's lines, final (owner + their dad, 2026-10-22): investment happens in أراضي، شقق، عمائر, so the
-- lines lead with purchase — volume (new for-sale ads, a city then its busiest district), this week against last
-- week, asking prices, this month against last month. Villas keep 2 lines, rent 3. Counts are ADS («إعلانات»),
-- with exact cross-site copies removed (same district, type, price and area on different sites; pins close).
set local statement_timeout = '2min';

insert into public.welcome_template(id, kind, personal, ar, en) values
 (32, 'city_land',       false, '{g} {n}، تدري إن عدد إعلانات الأراضي المعروضة في {city} {a}، أكثرها في {district}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} has {a} land listings on offer, most of them in {district}? Discover them with Ezhalah.'),
 (33, 'week_land',       false, '{g} {n}، تدري إن {city} أُضيف فيها هذا الأسبوع {a} من إعلانات الأراضي الجديدة للبيع، أكثرها في {district}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} got {a} new land-for-sale listings this week, most of them in {district}? Discover them with Ezhalah.'),
 (42, 'week_apt_sale',   false, '{g} {n}، تدري إن {city} أُضيف فيها هذا الأسبوع {a} من إعلانات الشقق الجديدة للبيع، أكثرها في {district}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} got {a} new apartment-for-sale listings this week, most of them in {district}? Discover them with Ezhalah.'),
 (43, 'wow_apt_sale_up', false, '{g} {n}، تدري إن إعلانات الشقق الجديدة للبيع في {city} زادت هذا الأسبوع {a}% عن الأسبوع الماضي؟ اكتشفها مع إزهله.', '{g} {n}, did you know new apartment-for-sale listings in {city} rose {a}% this week compared with last week? Discover them with Ezhalah.'),
 (44, 'wow_apt_sale_down', false, '{g} {n}، تدري إن إعلانات الشقق الجديدة للبيع في {city} قلّت هذا الأسبوع {a}% عن الأسبوع الماضي؟ اكتشفها مع إزهله.', '{g} {n}, did you know new apartment-for-sale listings in {city} fell {a}% this week compared with last week? Discover them with Ezhalah.'),
 (45, 'apt_sale_ppm',    false, '{g} {n}، تدري إن متوسط السعر المعروض لمتر الشقق للبيع في {district} ب{city} {a} ريال؟ اكتشفها مع إزهله.', '{g} {n}, did you know the median asking price for apartments for sale in {district}, {city} is {a} SAR per m²? Discover them with Ezhalah.'),
 (46, 'month_apt_ppm',   false, '{g} {n}، تدري إن متوسط السعر المعروض لمتر الشقق الجديدة للبيع في {district} ب{city} هذا الشهر {a} ريال، والشهر الماضي {b} ريال؟ اكتشفها مع إزهله.', '{g} {n}, did you know the median asking price for new apartments for sale in {district}, {city} is {a} SAR per m² this month, and was {b} SAR last month? Discover them with Ezhalah.'),
 (47, 'month_land_ppm',  false, '{g} {n}، تدري إن متوسط السعر المعروض لمتر الأرض في الإعلانات الجديدة في {city} هذا الشهر {a} ريال، والشهر الماضي {b} ريال؟ اكتشف أراضيها مع إزهله.', '{g} {n}, did you know the median asking land price in new listings in {city} is {a} SAR per m² this month, and was {b} SAR last month? Discover its land with Ezhalah.'),
 (48, 'week_bld_sale',   false, '{g} {n}، تدري إن {city} أُضيف فيها هذا الأسبوع {a} من إعلانات العمائر الجديدة للبيع، أكثرها في {district}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} got {a} new building-for-sale listings this week, most of them in {district}? Discover them with Ezhalah.'),
 (49, 'city_bld_sale',   false, '{g} {n}، تدري إن عدد إعلانات العمائر المعروضة للبيع في {city} {a}، أكثرها في {district}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} has {a} building-for-sale listings, most of them in {district}? Discover them with Ezhalah.'),
 (50, 'wow_bld_up',      false, '{g} {n}، تدري إن إعلانات العمائر الجديدة للبيع في {city} زادت هذا الأسبوع {a}% عن الأسبوع الماضي؟ اكتشفها مع إزهله.', '{g} {n}, did you know new building-for-sale listings in {city} rose {a}% this week compared with last week? Discover them with Ezhalah.'),
 (51, 'wow_bld_down',    false, '{g} {n}، تدري إن إعلانات العمائر الجديدة للبيع في {city} قلّت هذا الأسبوع {a}% عن الأسبوع الماضي؟ اكتشفها مع إزهله.', '{g} {n}, did you know new building-for-sale listings in {city} fell {a}% this week compared with last week? Discover them with Ezhalah.'),
 (52, 'bld_price',       false, '{g} {n}، تدري إن متوسط السعر المعروض للعمائر في {district} ب{city} {a} ريال؟ اكتشفها مع إزهله.', '{g} {n}, did you know the median asking price for buildings in {district}, {city} is {a} SAR? Discover them with Ezhalah.'),
 (53, 'month_bld_ppm',   false, '{g} {n}، تدري إن متوسط السعر المعروض لمتر العمائر في الإعلانات الجديدة في {city} هذا الشهر {a} ريال، والشهر الماضي {b} ريال؟ اكتشفها مع إزهله.', '{g} {n}, did you know the median asking price for buildings in new listings in {city} is {a} SAR per m² this month, and was {b} SAR last month? Discover them with Ezhalah.'),
 (54, 'villa_price',     false, '{g} {n}، تدري إن متوسط السعر المعروض للفلل في {district} ب{city} {a} ريال؟ اكتشفها مع إزهله.', '{g} {n}, did you know the median asking price for villas in {district}, {city} is {a} SAR? Discover them with Ezhalah.'),
 (55, 'city_sale',       false, '{g} {n}، تدري إن عدد إعلانات العقارات المعروضة للبيع في {city} {a}، أكثرها في {district}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} has {a} property-for-sale listings, most of them in {district}? Discover them with Ezhalah.')
on conflict (id) do update set kind = excluded.kind, personal = excluded.personal, ar = excluded.ar, en = excluded.en, active = true;

-- retired for purchase focus: rent share, monthly payment, furnished, commercial count, villa price per m², town week,
-- city week, apartment-rent week and week-on-week, villa week and week-on-week
update public.welcome_template set active = false where id in (12, 13, 14, 16, 21, 24, 31, 34, 35, 36, 37, 40, 41);

do $proof$
declare n int;
begin
  select count(*) into n from public.welcome_template where active;
  if n <> 31 then raise exception 'PROOF: % active lines, expected 31', n; end if;
  if exists (select 1 from public.welcome_template where active and (ar like '%{region}%' or en like '%{region}%')) then
    raise exception 'PROOF: an active line still names a region';
  end if;
  if exists (select 1 from public.welcome_template where active and ar ~ '(فرصة|أرخص|أفضل|استثمر|ننصح|صفقة|يستاهل|الوقت المناسب)') then
    raise exception 'PROOF: an active line gives advice';
  end if;
end $proof$;
