-- The home headline's insight sentences, corrected (owner 2026-10-22: «a lot of mistakes in the Arabic wording»).
-- Three classes of mistake removed, in both languages:
--   • number agreement — «14 إعلان», «3 حي» are wrong Arabic and the right form depends on the number, so every
--     count is now phrased so it is correct for ANY number («عدد إعلاناتها 14», «في 3 من أحيائها»,
--     «14 من الإعلانات»);
--   • gender — a district is masculine (اكتشفه), a city/region feminine (اكتشفها);
--   • register — «الحين» / «بس» / «نزل» replaced; the owner's own opener «تدري إن» is kept.
-- «X أضعاف» is gone too (2 is «ضعفين», 11+ «ضعفًا»): the rent comparison now shows both medians, as the land one does.
set local statement_timeout = '5min';

insert into public.welcome_template(id, kind, personal, ar, en) values
 (1,  'town_few',        false, '{g} {n}، تدري إن عدد إعلانات {city} في {region} {a} فقط، وأغلبها {type}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} in {region} has only {a} listings, mostly {type}? Discover it with Ezhalah.'),
 (2,  'town_single',     false, '{g} {n}، تدري إن {city} في {region} فيها إعلان واحد فقط، وهو {type}؟ اكتشفه مع إزهله.', '{g} {n}, did you know {city} in {region} has just one listing, a {type}? Discover it with Ezhalah.'),
 (3,  'city_new_districts', false, '{g} {n}، تدري إن {city} أُضيفت فيها إعلانات جديدة هذا الأسبوع في {a} من أحيائها؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} got new listings this week in {a} of its districts? Discover them with Ezhalah.'),
 (5,  'region_week',     false, '{g} {n}، تدري إن {region} أُضيف فيها هذا الأسبوع {a} من الإعلانات الجديدة، أكثرها في {city}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {region} got {a} new listings this week, most of them in {city}? Discover them with Ezhalah.'),
 (6,  'land_ppm_city',   false, '{g} {n}، تدري إن متوسط سعر متر الأرض في {city} ب{region} {a} ريال؟ اكتشف أراضيها مع إزهله.', '{g} {n}, did you know the median price of land in {city}, {region} is {a} SAR per m²? Discover its land with Ezhalah.'),
 (7,  'land_share',      false, '{g} {n}، تدري إن {a}% من إعلانات {city} أراضٍ؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a}% of the listings in {city} are land? Discover them with Ezhalah.'),
 (8,  'land_gap',        false, '{g} {n}، تدري إن متوسط سعر متر الأرض في {district} ب{city} {a} ريال، بينما في {district2} {b} ريال؟ اكتشف الفرق مع إزهله.', '{g} {n}, did you know the median land price in {district}, {city} is {a} SAR per m², while in {district2} it is {b} SAR? Discover the difference with Ezhalah.'),
 (9,  'region_land',     false, '{g} {n}، تدري إن عدد الأراضي المعروضة في {region} {a}، أكثرها في {city}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {region} has {a} plots of land on offer, most of them in {city}? Discover them with Ezhalah.'),
 (10, 'rent_apt',        false, '{g} {n}، تدري إن متوسط الإيجار السنوي للشقق في {district} ب{city} {a} ريال؟ اكتشفها مع إزهله.', '{g} {n}, did you know the median annual rent for apartments in {district}, {city} is {a} SAR? Discover them with Ezhalah.'),
 (11, 'rent_gap',        false, '{g} {n}، تدري إن متوسط الإيجار السنوي للشقق في {district} ب{city} {a} ريال، بينما في {district2} {b} ريال؟ اكتشف الفرق مع إزهله.', '{g} {n}, did you know the median annual apartment rent in {district}, {city} is {a} SAR, while in {district2} it is {b} SAR? Discover the difference with Ezhalah.'),
 (12, 'rent_share',      false, '{g} {n}، تدري إن {a}% من إعلانات {city} للإيجار؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a}% of the listings in {city} are for rent? Discover them with Ezhalah.'),
 (13, 'furnished',       false, '{g} {n}، تدري إن {a}% من شقق {district} ب{city} مفروشة؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a}% of the apartments in {district}, {city} are furnished? Discover them with Ezhalah.'),
 (14, 'monthly',         false, '{g} {n}، تدري إن عدد الإعلانات في {city} التي يمكن دفع إيجارها شهريًا {a}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a} listings in {city} can be rented with monthly payments? Discover them with Ezhalah.'),
 (15, 'villa_area',      false, '{g} {n}، تدري إن متوسط مساحة الفلل في {district} ب{city} {a} م²؟ اكتشفها مع إزهله.', '{g} {n}, did you know the median villa size in {district}, {city} is {a} m²? Discover them with Ezhalah.'),
 (16, 'villa_ppm',       false, '{g} {n}، تدري إن متوسط سعر متر الفلل في {district} ب{city} {a} ريال؟ اكتشفها مع إزهله.', '{g} {n}, did you know the median villa price in {district}, {city} is {a} SAR per m²? Discover them with Ezhalah.'),
 (17, 'maid',            false, '{g} {n}، تدري إن {a}% من فلل {district} ب{city} فيها غرفة خادمة؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a}% of the villas in {district}, {city} have a maid''s room? Discover them with Ezhalah.'),
 (18, 'pool',            false, '{g} {n}، تدري إن عدد الإعلانات التي فيها مسبح في {district} ب{city} {a}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a} listings in {district}, {city} have a pool? Discover them with Ezhalah.'),
 (19, 'new_build',       false, '{g} {n}، تدري إن {a}% من عقارات {district} ب{city} جديدة؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a}% of the properties in {district}, {city} are brand new? Discover them with Ezhalah.'),
 (20, 'shop_rent',       false, '{g} {n}، تدري إن متوسط الإيجار السنوي للمحلات في {district} ب{city} {a} ريال؟ اكتشفها مع إزهله.', '{g} {n}, did you know the median annual rent for shops in {district}, {city} is {a} SAR? Discover them with Ezhalah.'),
 (21, 'commercial_count', false, '{g} {n}، تدري إن عدد المحلات والمكاتب المعروضة للإيجار في {city} {a}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} has {a} shops and offices for rent? Discover them with Ezhalah.'),
 (22, 'hot_district',    false, '{g} {n}، تدري إن {district} ب{city} أُضيف فيه هذا الأسبوع {a} من الإعلانات الجديدة، أي {b}% من إعلاناته؟ اكتشفه مع إزهله.', '{g} {n}, did you know {district}, {city} got {a} new listings this week, {b}% of all its listings? Discover it with Ezhalah.'),
 (23, 'yesterday',       false, '{g} {n}، تدري إن عدد الإعلانات الجديدة في المملكة أمس بلغ {a}، منها {b} في {region}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a} new listings were added across the Kingdom yesterday, {b} of them in {region}? Discover them with Ezhalah.'),
 (24, 'town_week',       false, '{g} {n}، تدري إن {city} أُضيف فيها هذا الأسبوع {a} من الإعلانات، بعد أن كان عدد إعلاناتها {b} فقط؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} got {a} new listings this week, after having only {b}? Discover it with Ezhalah.'),
 (25, 'local_office',    false, '{g} {n}، تدري إن {a}% من إعلانات {city} من مكاتب عقارية محلية؟ اكتشفها كلها مع إزهله.', '{g} {n}, did you know {a}% of the listings in {city} come from local real-estate offices? Discover them all with Ezhalah.'),
 (26, 'district_sites',  false, '{g} {n}، تدري إن إعلانات {district} ب{city} موجودة في {a} من المواقع العقارية المختلفة؟ اكتشفها كلها مع إزهله.', '{g} {n}, did you know listings in {district}, {city} appear on {a} different real-estate websites? Discover them all with Ezhalah.'),
 (27, 'region_sites',    false, '{g} {n}، تدري إن عدد المواقع العقارية التي لديها إعلانات في {region} {a}؟ اكتشفها كلها مع إزهله.', '{g} {n}, did you know {a} real-estate websites have listings in {region}? Discover them all with Ezhalah.'),
 (28, 'hot_district',    true,  '{g} {n}، تدري إن {district} أُضيف فيه هذا الأسبوع {a} من الإعلانات الجديدة؟ اكتشفها مع إزهله.', '{g} {n}, did you know {district} got {a} new listings this week? Discover them with Ezhalah.'),
 (29, 'min_rent_apt',    true,  '{g} {n}، تدري إن أقل إيجار سنوي لشقة في {district} حاليًا {a} ريال؟ اكتشفها مع إزهله.', '{g} {n}, did you know the lowest annual rent for an apartment in {district} right now is {a} SAR? Discover it with Ezhalah.'),
 (30, 'new_build',       true,  '{g} {n}، تدري إن {a}% من عقارات {district} جديدة؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a}% of the properties in {district} are brand new? Discover them with Ezhalah.')
on conflict (id) do update set kind = excluded.kind, personal = excluded.personal, ar = excluded.ar, en = excluded.en;

create or replace function public.build_welcome_insights()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  d date := (now() at time zone 'Asia/Riyadh')::date;
  y0 timestamptz := (date_trunc('day', now() at time zone 'Asia/Riyadh') - interval '1 day') at time zone 'Asia/Riyadh';
  y1 timestamptz := date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh';
  wk timestamptz := now() - interval '7 days';
  big text[] := array['aqar','wasalt','dealapp','haraj','gathern','aqarmonthly','opensooq','bayut','sakan','dwelleo','muhaysini'];
  v_total int;
begin
  drop table if exists w_b, w_dname, w_town, w_rent;
  create temp table w_b on commit drop as
    select s.source_table, s.listing_id, s.platform, s.region_ar, s.city_ar, s.city_id, nullif(nullif(trim(s.district_ar), ''), 'غير معروف') district_ar,
           s.deal_ar, s.type_ar, s.price_annual, s.price_total, s.price_per_meter, s.area_m2, s.furnished, s.property_age,
           s.maid_room, s.pool, s.payment_monthly, s.rent_now_pay_later, s.first_seen_at
      from public.search_listings_ar s
     where s.production_ready and s.city_ar is not null and s.city_ar <> 'غير معروف' and s.region_ar is not null;
  -- a town: a catalogue city whose name is not also some city's district; never speaks through an adjudicated far pin
  create temp table w_dname on commit drop as
    select distinct regexp_replace(x.district_norm, '^حي\s+', '') nm from public.loc_catalog_district x;
  create temp table w_town on commit drop as
    select c.city_id from public.loc_catalog_city c
     where regexp_replace(c.city_norm, '^حي\s+', '') not in (select nm from w_dname where nm is not null);

  delete from public.welcome_insight where day <= d;   -- today's rebuild replaces itself; older days go

  -- 1/2. small towns: how few, and of which type
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, type_ar, a)
  select d, case when n = 1 then 'town_single' else 'town_few' end, region_ar, city_ar, city_id, top_type, n
    from (select c.city_id, min(c.region_ar) region_ar, min(c.city_ar) city_ar, sum(c.cnt) n,
                 (array_agg(c.type_ar order by c.cnt desc))[1] top_type, max(c.cnt) top_n
            from (select b.city_id, b.region_ar, b.city_ar, b.type_ar, count(*) cnt
                    from w_b b
                    join w_town t on t.city_id = b.city_id
                   where b.type_ar <> 'غير معروف'
                     and not exists (select 1 from public.ops_far_pin_register f where f.source_table = b.source_table and f.listing_id = b.listing_id)
                   group by 1, 2, 3, 4) c
           group by c.city_id) z
   where (n = 1) or (n between 2 and 40 and top_n * 2 > n);

  -- 3. districts with new listings this week, per city
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, a)
  select d, 'city_new_districts', min(region_ar), city_ar, min(city_id), count(distinct district_ar)
    from w_b where first_seen_at >= wk and district_ar is not null group by city_ar having count(distinct district_ar) >= 3;

  -- 5. new this week per region, and where most of it landed
  insert into public.welcome_insight(day, kind, region_ar, city_ar, a)
  select d, 'region_week', region_ar, (array_agg(city_ar order by c desc))[1], sum(c)
    from (select region_ar, city_ar, count(*) c from w_b where first_seen_at >= wk group by 1,2) z
   group by region_ar having sum(c) >= 20;

  -- 6/7/9. land
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, a)
  select d, 'land_ppm_city', min(region_ar), city_ar, min(city_id), round(percentile_cont(0.5) within group (order by price_per_meter)::numeric)
    from w_b where deal_ar = 'بيع' and type_ar like 'أرض%' and price_per_meter between 10 and 50000 group by city_ar having count(*) >= 10;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, a)
  select d, 'land_share', min(region_ar), city_ar, min(city_id), round(100.0 * count(*) filter (where type_ar like 'أرض%') / count(*))
    from w_b group by city_ar having count(*) >= 40 and count(*) filter (where type_ar like 'أرض%') * 100 >= count(*) * 15;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, a)
  select d, 'region_land', region_ar, (array_agg(city_ar order by c desc))[1], sum(c)
    from (select region_ar, city_ar, count(*) c from w_b where type_ar like 'أرض%' group by 1,2) z group by region_ar having sum(c) >= 20;

  -- 8. land price gap between two districts of one city
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, district2_ar, a, b)
  select d, 'land_gap', region_ar, city_ar, city_id, hi, lo, hiv, lov
    from (select city_ar, min(region_ar) region_ar, min(city_id) city_id,
                 (array_agg(district_ar order by m desc))[1] hi, (array_agg(district_ar order by m))[1] lo, round(max(m)::numeric) hiv, round(min(m)::numeric) lov
            from (select city_ar, region_ar, city_id, district_ar, percentile_cont(0.5) within group (order by price_per_meter) m
                    from w_b where deal_ar = 'بيع' and type_ar like 'أرض%' and price_per_meter between 10 and 50000 and district_ar is not null
                   group by 1,2,3,4 having count(*) >= 10) q
           group by city_ar having count(*) >= 3) z
   where hiv >= lov * 2;

  -- 10/11/29. apartment rent
  create temp table w_rent on commit drop as
    select city_ar, min(region_ar) region_ar, min(city_id) city_id, district_ar,
           percentile_cont(0.5) within group (order by price_annual) m, min(price_annual) lo, count(*) n
      from w_b where deal_ar = 'إيجار' and type_ar = 'شقة' and price_annual between 6000 and 500000 and district_ar is not null
     group by city_ar, district_ar;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a)
  select d, 'rent_apt', region_ar, city_ar, city_id, district_ar, round(m::numeric) from w_rent where n >= 20;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a)
  select d, 'min_rent_apt', region_ar, city_ar, city_id, district_ar, round(lo::numeric) from w_rent where n >= 5;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, district2_ar, a, b)
  select d, 'rent_gap', region_ar, city_ar, city_id, hi, lo, round(hiv::numeric), round(lov::numeric)
    from (select city_ar, min(region_ar) region_ar, min(city_id) city_id,
                 (array_agg(district_ar order by m desc))[1] hi, (array_agg(district_ar order by m))[1] lo, max(m) hiv, min(m) lov
            from w_rent where n >= 20 group by city_ar having count(*) >= 4) z
   where hiv >= lov * 2;

  -- 12/14/21/25. city shares and counts
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, a)
  select d, 'rent_share', min(region_ar), city_ar, min(city_id), round(100.0 * count(*) filter (where deal_ar = 'إيجار') / count(*))
    from w_b group by city_ar having count(*) >= 100;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, a)
  select d, 'monthly', min(region_ar), city_ar, min(city_id), count(*)
    from w_b where deal_ar = 'إيجار' and (payment_monthly or rent_now_pay_later) group by city_ar having count(*) >= 20;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, a)
  select d, 'commercial_count', min(region_ar), city_ar, min(city_id), count(*)
    from w_b where deal_ar = 'إيجار' and type_ar in ('محل', 'مكتب') group by city_ar having count(*) >= 20;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, a)
  select d, 'local_office', min(region_ar), city_ar, min(city_id), round(100.0 * count(*) filter (where not platform = any(big)) / count(*))
    from w_b group by city_ar having count(*) >= 100 and count(*) filter (where not platform = any(big)) * 5 >= count(*);

  -- 13/15/16/17/18/19/20/22/26. districts
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a)
  select d, 'furnished', min(region_ar), city_ar, min(city_id), district_ar, round(100.0 * count(*) filter (where furnished) / count(*))
    from w_b where deal_ar = 'إيجار' and type_ar = 'شقة' and furnished is not null and district_ar is not null
   group by city_ar, district_ar having count(*) >= 40 and count(*) filter (where furnished) * 5 >= count(*);
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a)
  select d, 'villa_area', min(region_ar), city_ar, min(city_id), district_ar, round(percentile_cont(0.5) within group (order by area_m2)::numeric)
    from w_b where type_ar = 'فيلا' and area_m2 between 100 and 5000 and district_ar is not null group by city_ar, district_ar having count(*) >= 20;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a)
  select d, 'villa_ppm', min(region_ar), city_ar, min(city_id), district_ar, round(percentile_cont(0.5) within group (order by price_total / area_m2)::numeric)
    from w_b where deal_ar = 'بيع' and type_ar = 'فيلا' and price_total between 200000 and 50000000 and area_m2 between 100 and 5000 and district_ar is not null
   group by city_ar, district_ar having count(*) >= 20;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a)
  select d, 'maid', min(region_ar), city_ar, min(city_id), district_ar, round(100.0 * count(*) filter (where maid_room) / count(*))
    from w_b where type_ar = 'فيلا' and maid_room is not null and district_ar is not null
   group by city_ar, district_ar having count(*) >= 40 and count(*) filter (where maid_room) * 2 >= count(*);
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a)
  select d, 'pool', min(region_ar), city_ar, min(city_id), district_ar, count(*)
    from w_b where pool and district_ar is not null group by city_ar, district_ar having count(*) >= 5;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a)
  select d, 'new_build', min(region_ar), city_ar, min(city_id), district_ar, round(100.0 * count(*) filter (where property_age = 0) / count(*))
    from w_b where property_age is not null and district_ar is not null
   group by city_ar, district_ar having count(*) >= 20 and count(*) filter (where property_age = 0) * 10 >= count(*) * 3;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a)
  select d, 'shop_rent', min(region_ar), city_ar, min(city_id), district_ar, round(percentile_cont(0.5) within group (order by price_annual)::numeric)
    from w_b where deal_ar = 'إيجار' and type_ar = 'محل' and price_annual between 3000 and 2000000 and district_ar is not null
   group by city_ar, district_ar having count(*) >= 15;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a, b)
  select d, 'hot_district', min(region_ar), city_ar, min(city_id), district_ar, count(*) filter (where first_seen_at >= wk),
         round(100.0 * count(*) filter (where first_seen_at >= wk) / count(*))
    from w_b where district_ar is not null group by city_ar, district_ar having count(*) filter (where first_seen_at >= wk) >= 10;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, a)
  select d, 'district_sites', min(region_ar), city_ar, min(city_id), district_ar, count(distinct platform)
    from w_b where district_ar is not null group by city_ar, district_ar having count(distinct platform) >= 8;

  -- 23/24/27. the Kingdom yesterday, towns this week, regions by websites
  insert into public.welcome_insight(day, kind, region_ar, a, b)
  select d, 'yesterday', region_ar, (select count(*) from w_b where first_seen_at >= y0 and first_seen_at < y1), c
    from (select region_ar, count(*) c from w_b where first_seen_at >= y0 and first_seen_at < y1 group by 1) z where c >= 5;
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, a, b)
  select d, 'town_week', min(region_ar), city_ar, min(city_id), count(*) filter (where first_seen_at >= wk), count(*) filter (where first_seen_at < wk)
    from w_b group by city_ar
  having count(*) filter (where first_seen_at >= wk) >= 10 and count(*) filter (where first_seen_at < wk) between 1 and 300
     and count(*) filter (where first_seen_at >= wk) * 4 >= count(*) filter (where first_seen_at < wk);
  insert into public.welcome_insight(day, kind, region_ar, a)
  select d, 'region_sites', region_ar, count(distinct platform) from w_b group by region_ar having count(distinct platform) >= 5;

  select count(*) into v_total from public.welcome_insight where day = d;
  return v_total;
end
$function$;


-- Rebuild today with the new rent comparison, and prove the new wording holds.
do $proof$
declare r int; bad int;
begin
  r := public.build_welcome_insights();
  if r < 200 then raise exception 'PROOF: only % insights after the rebuild', r; end if;
  select count(*) into bad from public.welcome_insight where kind = 'rent_gap' and (a is null or b is null or a < b * 2);
  if bad > 0 then raise exception 'PROOF: % rent comparisons without two medians or under 2x', bad; end if;
  select count(*) into bad from public.welcome_template where ar like '%أضعاف%' or ar like '%الحين%' or ar like '% بس%' or ar like '%بـ%';
  if bad > 0 then raise exception 'PROOF: % sentences still carry the old wording', bad; end if;
end $proof$;
