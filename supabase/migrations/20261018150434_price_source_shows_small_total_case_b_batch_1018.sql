-- 2026-10-18. PRICE = SOURCE, case (b): served sale plots under their city's floor whose own page shows that number as
-- the price (served_total_below_city_floor -> ops_price_source_verified, owner list). Every row was read live today; the
-- evidence names the URL, the field and the figure, and none states a per-metre rate for that figure.
--   abwbna 59 of the 60 listed (the 60th, 39641, states «سعر المتر 1100»: fixed in #7536); dealapp 8 of 34 (24 carry
--   dealapp's own «سعر المتر 1/2/3 ريال» with the price = that rate x the area — the placeholder class that waits for the
--   owner, like aqar's 1 SAR/m² rows — 1 was not readable, and 15309726 says «ايجار سنوي»: a deal question, not this list);
--   ksaaqar 10 of 14 (3 state their rate: fixed in #7537;
--   14119343 «1.00 ريال» is a placeholder and waits); alshawaf 20098 and abralosol 7939, read with the site's own card
--   and table row («السوم 4,000», «السعر 830»; no «المتر» on them).
set local lock_timeout = '5s';

insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
select 'abwbna_' || case k when 'r' then 'residential' else 'commercial' end || '_listings', id,
       format('Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 15:00-15:05 UTC from https://www.abwbna.com/properties/%s: '
              'the page shows %s as «سعر البيع» (API selling_price = the stored price) on %s m²; the description states no per-metre '
              'rate. The source shows this number as the price — kept (PRICE = SOURCE), owner list.', pid, price, area), now()
  from (values
  (10777597, 'r', 53048, 2000, 1264),
  (10777598, 'r', 53047, 1500, 511),
  (10777599, 'r', 51967, 2050, 1338),
  (10777600, 'r', 51194, 1600, 403),
  (10777601, 'r', 51193, 1600, 426),
  (10777645, 'r', 49384, 1700, 375),
  (10777646, 'r', 49194, 2000, 500),
  (10777647, 'r', 48567, 1600, 556),
  (10777648, 'r', 48252, 2200, 1860),
  (10777649, 'r', 48251, 2100, 500),
  (10777650, 'r', 48250, 2200, 500),
  (10777651, 'r', 48083, 1300, 701),
  (10777652, 'r', 46725, 3500, 924),
  (10777653, 'r', 46724, 3500, 840),
  (10777654, 'r', 46690, 3500, 1043),
  (10777655, 'r', 46667, 2000, 478),
  (10777657, 'r', 46460, 1600, 322),
  (10777658, 'r', 46459, 1600, 484),
  (10777662, 'r', 44465, 1750, 350),
  (10777663, 'r', 44074, 1500, 440),
  (10777664, 'r', 43952, 3000, 1155),
  (10777665, 'r', 43834, 2000, 4300),
  (10777666, 'r', 43592, 2500, 2329),
  (10777668, 'r', 41040, 1600, 800),
  (10777669, 'r', 41034, 1550, 700),
  (10777670, 'r', 40309, 1800, 720),
  (10777671, 'r', 40013, 1350, 750),
  (10777672, 'r', 39927, 1500, 800),
  (10777673, 'r', 39704, 2500, 1020),
  (10777675, 'r', 39640, 1400, 741),
  (10777677, 'r', 39638, 650, 1040),
  (10777678, 'r', 39358, 1600, 800),
  (10777679, 'r', 38887, 1600, 800),
  (10777680, 'r', 38515, 2200, 800),
  (10777681, 'r', 27186, 1520, 484),
  (10777684, 'r', 37213, 1750, 600),
  (10777686, 'r', 36717, 1400, 367),
  (10777687, 'r', 36702, 1250, 700),
  (10777688, 'r', 27904, 1350, 518),
  (10777689, 'r', 27512, 1700, 287),
  (10777690, 'r', 27511, 1700, 287),
  (10777691, 'r', 27062, 1500, 1396),
  (10777692, 'r', 26932, 1450, 800),
  (10777693, 'r', 26761, 1500, 304),
  (10777696, 'r', 26675, 1800, 800),
  (10777697, 'r', 26636, 1500, 316),
  (10777698, 'r', 26620, 1650, 300),
  (10777699, 'r', 26619, 1600, 479),
  (10777700, 'r', 26535, 1600, 453),
  (10777701, 'r', 26522, 1800, 495),
  (10777702, 'r', 26519, 1700, 650),
  (10777703, 'r', 26516, 1600, 500),
  (10777704, 'r', 26492, 1350, 750),
  (10777705, 'r', 26479, 1500, 1801),
  (10777751, 'c', 36669, 1950, 3991),
  (10777757, 'c', 26709, 220, 5000),
  (10777758, 'c', 26708, 220, 5000),
  (10777759, 'c', 26674, 1900, 900),
  (10777760, 'c', 26493, 1450, 800)
  ) as v(id, k, pid, price, area)
union all
select 'dealapp_' || case k when 'r' then 'residential' else 'commercial' end || '_listings', id,
       format('Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 15:05-15:10 UTC (fresh render) from '
              'https://dealapp.sa/ar/ad-details/%s: offers.price = %s = the stored price on %s m², dealapp''s own «سعر المتر» reads «%s»; the '
              'description states no per-metre rate. The source shows this number as the price — kept (PRICE = SOURCE), owner list.',
              adid, price, area, ppm), now()
  from (values
  (1274915, 'r', 409036, 520, 600, '0.87 ريال'),
  (4748682, 'r', 555513, 280, 401, '0.7 ريال'),
  (5132569, 'r', 556915, 350, 290, '1.21 ريال'),
  (14984667, 'r', 415931, 580, 450, '1.29 ريال'),
  (15307497, 'r', 466949, 250, 596, '0.42 ريال'),
  (16156166, 'r', 603837, 700, 631, '1.11 ريال'),
  (17019150, 'r', 595917, 2587, 1056, '2.45 ريال'),
  (17927544, 'r', 590073, 350, 600, '0.58 ريال')
  ) as v(id, k, adid, price, area, ppm)
union all
select 'ksaaqar_residential_listings', id,
       format('Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 15:15 UTC from https://ksaaqar.com/ad/%s/: the ad''s own '
              'card prints %s ريال = the stored price; the description states no per-metre rate for it. The source shows this number as '
              'the price — kept (PRICE = SOURCE), owner list.', slug, price), now()
  from (values
  (12225746, '%d8%a7%d8%b1%d8%b6-%d8%a8%d8%b5%d9%83-%d9%81%d9%8a-%d8%b9%d8%b3%d9%8a%d8%b1-%d8%a7%d9%84%d8%ad%d8%b1%d9%8a%d8%b6%d9%87', 200),
  (12225782, '%d8%a7%d8%b1%d8%b6-%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%81%d9%8a-%d8%a7%d9%84%d9%86%d8%b1%d8%ac%d8%b3', 2900),
  (12225783, '%d8%a3%d8%b1%d8%a7%d8%b6%d9%8a-%d9%84%d9%84%d8%a8%d9%8a%d8%b9', 3200),
  (12225790, '%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%82%d8%b7%d8%b9%d8%a9-%d8%a7%d8%b1%d8%b6-%d9%81%d9%8a-%d8%ad%d8%b7%d9%8a%d9%86-%d8%a7%d9%84%d9%86%d9%85%d9%88%d8%b0%d8%ac%d9%8a', 9000),
  (12225797, '%d8%a7%d8%b1%d8%a7%d8%b6%d9%8a-%d9%88%d9%84%d9%8a-%d8%a7%d9%84%d8%b9%d9%87%d8%af', 500),
  (12225879, '%d9%84%d9%84%d8%a8%d9%8a%d8%b9-%d9%82%d8%b7%d8%b9%d8%a9-%d8%a7%d8%b1%d8%b6-%d9%81%d9%8a-%d8%ac%d8%af%d9%87-%d8%ac%d9%88%d9%87%d8%b1%d8%a9-%d8%a7%d9%84%d8%b9%d8%b1%d9%88%d8%b3-%d8%ac%d8%b2%d8%a1-%d9%a1', 800),
  (12225908, '%d8%a7%d8%b1%d8%b6-2', 600),
  (12226427, '%d9%85%d9%86%d8%ad%d9%87-%d8%a7%d9%84%d9%82%d8%ab%d9%85%d9%87-%d8%a8%d8%b9%d8%b4%d9%8a%d8%b1%d9%87-%d8%a8%d9%85%d8%ae%d8%b7%d8%b7-%d8%a7%d9%84%d8%ad%d8%a8%d8%a7%d9%84%d8%b5%d9%87', 100),
  (12226428, '%d9%85%d9%86%d8%ad%d9%87-%d8%a7%d9%84%d9%82%d8%ab%d9%85%d9%87-%d8%a8%d8%b9%d8%b4%d9%8a%d8%b1%d9%87-%d8%a8%d9%85%d8%ae%d8%b7%d8%b7-%d8%a7%d9%84%d8%ad%d9%85%d8%a7%d9%84%d8%b5%d9%87', 150),
  (12226696, '%d8%ac%d9%88%d9%87%d8%b1%d8%a9-%d8%a7%d9%84%d8%b9%d8%b1%d9%88%d8%b3', 230)
  ) as v(id, slug, price)
union all
select 'alshawaf_commercial_listings', 12605979,
       'Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 14:10 UTC from https://alshawaf.com.sa/20098 and the site''s own '
       'cards for #20098 on /20888 and /21621: «سعر السوم 4,000» / card «السوم 4,000» on 1,000 m² (the site prints «المتر N» on other ads, '
       'e.g. #21621 «المتر 1,800», not on this one). The source shows this number as the price — kept (PRICE = SOURCE), owner list.', now()
union all
select 'abralosol_residential_listings', 14434045,
       'Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 14:12 UTC from https://abralosol.com/7939 and the site''s own '
       'table row for 7939 on /7855: «السعر 830 ريال» / row «السعر 830» on 731 m² (the same table prints «المتر 1,135» for 7855, which we '
       'store as a rate). The source shows this number as the price — kept (PRICE = SOURCE), owner list.', now()
on conflict (source_table, listing_id) do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.ops_price_source_verified
   where evidence like 'Price fidelity 2026-10-18 (served_total_below_city_floor). Read live 1%' and verified_at >= now() - interval '1 minute';
  if n <> 79 then raise exception 'PROOF: expected 79 owner-list rows written, found %', n; end if;
end $$;