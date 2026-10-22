-- THE HOME HEADLINE'S DAILY INSIGHTS (owner 2026-10-22). A signed-in user's headline becomes a greeting by
-- Saudi time + «تدري إن …» + a fact Ezhalah's own data says today, about ANY of the Kingdom's towns, districts
-- and regions — not the obvious «Riyadh is number one». Approved wording: «تدري إن», «اكتشف…» (never
-- «قارن»), no hype («فرصة نادرة» rejected). A new line every 2 hours, different per user.
--
-- Nothing is fixed: build_welcome_insights() recomputes every fact from search_listings_ar each night
-- (pg_cron 21:40 UTC = 00:40 Riyadh, so «أمس» is a whole Riyadh day) and deletes older days. The app reads
-- one random sample through welcome_insights_pick(); the greeting is added on the device at the moment the
-- line is SHOWN, from Riyadh time, so a line prepared in the morning can never say «صباح الخير» at night.
--
-- TRUTH RULES, all enforced here and not in the wording:
--   • every number is a count/median over production_ready rows of that night; medians need a floor of rows;
--   • «أغلبها» only when one type is more than half; «X أضعاف» is the ratio rounded DOWN and ≥ 2;
--   • a town is a catalogue city whose name is not also a district somewhere (الثقبة is a Khobar district),
--     and an ad already adjudicated as a far pin never speaks for its town;
--   • a fact that cannot be phrased in English (no English place name on the device) is skipped by the app.
set local statement_timeout = '5min';

create table if not exists public.welcome_insight (
  id          bigserial primary key,
  day         date not null,
  kind        text not null,
  region_ar   text,
  city_ar     text,
  city_id     int,
  district_ar text,
  district2_ar text,
  type_ar     text,
  a           numeric,
  b           numeric
);
create index if not exists welcome_insight_day_kind on public.welcome_insight(day, kind);
create index if not exists welcome_insight_day_city on public.welcome_insight(day, city_ar);
alter table public.welcome_insight enable row level security;

create table if not exists public.welcome_template (
  id        int primary key,
  kind      text not null,
  personal  boolean not null default false,
  ar        text not null check (ar like '%{g}%' and ar like '%{n}%' and ar like '%تدري إن%' and ar like '%إزهله%' and ar not like '%قارن%'),
  en        text not null check (en like '%{g}%' and en like '%{n}%' and en like '%Ezhalah%'),
  active    boolean not null default true
);
alter table public.welcome_template enable row level security;
comment on table public.welcome_template is
  'Owner-approved sentence shapes for the home headline (2026-10-22). {g} greeting (added on the device by Riyadh time), {n} first name, {city} {region} {district} {district2} {type} places, {a} {b} numbers from welcome_insight. Turn a line off with active=false; never put a number in the text.';

insert into public.welcome_template(id, kind, personal, ar, en) values
 (1,  'town_few',        false, '{g} {n}، تدري إن {city} في {region} فيها {a} إعلان بس، وأغلبها {type}؟ اكتشف {city} مع إزهله.', '{g} {n}, did you know {city} in {region} has only {a} listings, mostly {type}? Discover {city} with Ezhalah.'),
 (2,  'town_single',     false, '{g} {n}، تدري إن {city} في {region} معروض فيها إعلان واحد بس، وهو {type}؟ اكتشفه مع إزهله.', '{g} {n}, did you know {city} in {region} has just one listing, a {type}? Discover it with Ezhalah.'),
 (3,  'city_new_districts', false, '{g} {n}، تدري إن {city} نزلت فيها إعلانات جديدة هذا الأسبوع في {a} حي؟ اكتشف أحياءها مع إزهله.', '{g} {n}, did you know {city} had new listings in {a} districts this week? Discover its districts with Ezhalah.'),
 (5,  'region_week',     false, '{g} {n}، تدري إن {region} نزل فيها {a} إعلان جديد هذا الأسبوع، وأكثرها في {city}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {region} got {a} new listings this week, most of them in {city}? Discover them with Ezhalah.'),
 (6,  'land_ppm_city',   false, '{g} {n}، تدري إن متوسط سعر متر الأرض في {city} بـ{region} {a} ريال؟ اكتشف أراضيها مع إزهله.', '{g} {n}, did you know land in {city}, {region} goes for a median of {a} SAR per m²? Discover its land with Ezhalah.'),
 (7,  'land_share',      false, '{g} {n}، تدري إن {a}% من إعلانات {city} أراضي؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a}% of the listings in {city} are land? Discover them with Ezhalah.'),
 (8,  'land_gap',        false, '{g} {n}، تدري إن متوسط متر الأرض في {district} بـ{city} {a} ريال، وفي {district2} بنفس المدينة {b} ريال؟ اكتشف الفرق مع إزهله.', '{g} {n}, did you know land in {district}, {city} is a median of {a} SAR per m², and {b} SAR in {district2} in the same city? Discover the difference with Ezhalah.'),
 (9,  'region_land',     false, '{g} {n}، تدري إن {region} فيها {a} أرض معروضة الحين، أكثرها في {city}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {region} has {a} plots of land on offer right now, most of them in {city}? Discover them with Ezhalah.'),
 (10, 'rent_apt',        false, '{g} {n}، تدري إن متوسط إيجار الشقق في {district} بـ{city} {a} ريال بالسنة؟ اكتشفها مع إزهله.', '{g} {n}, did you know apartments in {district}, {city} rent for a median of {a} SAR a year? Discover them with Ezhalah.'),
 (11, 'rent_gap',        false, '{g} {n}، تدري إن إيجار الشقق في {district} بـ{city} {a} أضعاف {district2} في نفس المدينة؟ اكتشف الفرق مع إزهله.', '{g} {n}, did you know apartment rents in {district}, {city} are {a} times those in {district2}, in the same city? Discover the difference with Ezhalah.'),
 (12, 'rent_share',      false, '{g} {n}، تدري إن {a}% من إعلانات {city} للإيجار؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a}% of the listings in {city} are for rent? Discover them with Ezhalah.'),
 (13, 'furnished',       false, '{g} {n}، تدري إن {a}% من شقق {district} بـ{city} مفروشة؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a}% of the apartments in {district}, {city} are furnished? Discover them with Ezhalah.'),
 (14, 'monthly',         false, '{g} {n}، تدري إن {a} إعلان في {city} تقدر تدفع إيجارها شهري؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a} listings in {city} let you pay the rent monthly? Discover them with Ezhalah.'),
 (15, 'villa_area',      false, '{g} {n}، تدري إن متوسط مساحة الفلل في {district} بـ{city} {a} م²؟ اكتشفها مع إزهله.', '{g} {n}, did you know villas in {district}, {city} have a median size of {a} m²? Discover them with Ezhalah.'),
 (16, 'villa_ppm',       false, '{g} {n}، تدري إن متوسط سعر متر الفلل في {district} بـ{city} {a} ريال؟ اكتشفها مع إزهله.', '{g} {n}, did you know villas in {district}, {city} sell for a median of {a} SAR per m²? Discover them with Ezhalah.'),
 (17, 'maid',            false, '{g} {n}، تدري إن {a}% من فلل {district} بـ{city} فيها غرفة خادمة؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a}% of the villas in {district}, {city} have a maid''s room? Discover them with Ezhalah.'),
 (18, 'pool',            false, '{g} {n}، تدري إن {district} بـ{city} فيه {a} إعلان فيه مسبح؟ اكتشفها مع إزهله.', '{g} {n}, did you know {district}, {city} has {a} listings with a pool? Discover them with Ezhalah.'),
 (19, 'new_build',       false, '{g} {n}، تدري إن {a}% من عقارات {district} بـ{city} جديدة؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a}% of the properties in {district}, {city} are brand new? Discover them with Ezhalah.'),
 (20, 'shop_rent',       false, '{g} {n}، تدري إن متوسط إيجار المحلات في {district} بـ{city} {a} ريال بالسنة؟ اكتشفها مع إزهله.', '{g} {n}, did you know shops in {district}, {city} rent for a median of {a} SAR a year? Discover them with Ezhalah.'),
 (21, 'commercial_count', false, '{g} {n}، تدري إن {city} فيها {a} محل ومكتب للإيجار الحين؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} has {a} shops and offices for rent right now? Discover them with Ezhalah.'),
 (22, 'hot_district',    false, '{g} {n}، تدري إن {district} بـ{city} نزل فيه {a} إعلان جديد هذا الأسبوع، يعني {b}% من إعلاناته؟ اكتشفه مع إزهله.', '{g} {n}, did you know {district}, {city} got {a} new listings this week, {b}% of all its listings? Discover it with Ezhalah.'),
 (23, 'yesterday',       false, '{g} {n}، تدري إن {a} إعلان جديد نزل أمس في المملكة، منها {b} في {region}؟ اكتشفها مع إزهله.', '{g} {n}, did you know {a} new listings came in across the Kingdom yesterday, {b} of them in {region}? Discover them with Ezhalah.'),
 (24, 'town_week',       false, '{g} {n}، تدري إن {city} نزل فيها {a} إعلان هذا الأسبوع، وكان فيها قبلها {b} بس؟ اكتشفها مع إزهله.', '{g} {n}, did you know {city} got {a} new listings this week, on top of only {b} before? Discover it with Ezhalah.'),
 (25, 'local_office',    false, '{g} {n}، تدري إن {a}% من إعلانات {city} من مكاتب عقارية محلية؟ اكتشفها كلها مع إزهله.', '{g} {n}, did you know {a}% of the listings in {city} come from local real-estate offices? Discover them all with Ezhalah.'),
 (26, 'district_sites',  false, '{g} {n}، تدري إن {district} بـ{city} معروض في {a} موقع عقاري مختلف؟ اكتشفها كلها مع إزهله.', '{g} {n}, did you know {district}, {city} is listed on {a} different real-estate websites? Discover them all with Ezhalah.'),
 (27, 'region_sites',    false, '{g} {n}، تدري إن {a} موقع عقاري عندها إعلانات في {region}؟ اكتشفها كلها مع إزهله.', '{g} {n}, did you know {a} real-estate websites have listings in {region}? Discover them all with Ezhalah.'),
 (28, 'hot_district',    true,  '{g} {n}، تدري إن {district} نزل فيه {a} إعلان جديد هذا الأسبوع؟ اكتشفها مع إزهله.', '{g} {n}, did you know {district} got {a} new listings this week? Discover them with Ezhalah.'),
 (29, 'min_rent_apt',    true,  '{g} {n}، تدري إن أقل إيجار شقة في {district} الحين {a} ريال بالسنة؟ اكتشفها مع إزهله.', '{g} {n}, did you know the lowest apartment rent in {district} right now is {a} SAR a year? Discover it with Ezhalah.'),
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
  insert into public.welcome_insight(day, kind, region_ar, city_ar, city_id, district_ar, district2_ar, a)
  select d, 'rent_gap', region_ar, city_ar, city_id, hi, lo, floor(hiv / lov)
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

-- The app's ONE read: today's templates + a random sample of today's facts (some from every kind, more for
-- the user's city, and their own district's facts for the personal lines). Anon-callable, bounded output.
create or replace function public.welcome_insights_pick(p_city text default null, p_district text default null)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with day as (select max(day) d from public.welcome_insight),
  pool as (
    select * from (select w.*, row_number() over (partition by w.kind order by random()) rn
                     from public.welcome_insight w, day where w.day = day.d) z where rn <= 6
    union
    select w.*, 0 from public.welcome_insight w, day where w.day = day.d and p_city is not null and w.city_ar = p_city
       and w.id in (select id from public.welcome_insight w2, day where w2.day = day.d and w2.city_ar = p_city order by random() limit 25)
    union
    select w.*, 0 from public.welcome_insight w, day where w.day = day.d and p_district is not null and w.district_ar = p_district
       and (p_city is null or w.city_ar = p_city)
  )
  select jsonb_build_object(
    'day', (select d from day),
    'templates', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'personal', personal, 'ar', ar, 'en', en) order by id), '[]') from public.welcome_template where active),
    'insights', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'region', region_ar, 'city', city_ar, 'city_id', city_id,
                   'district', district_ar, 'district2', district2_ar, 'type', type_ar, 'a', a, 'b', b)), '[]') from pool));
$function$;
grant execute on function public.welcome_insights_pick(text, text) to anon, authenticated;

-- nightly, 00:40 Riyadh
select cron.unschedule(jobid) from cron.job where jobname = 'build-welcome-insights';
select cron.schedule('build-welcome-insights', '40 21 * * *', $$set statement_timeout to '300s'; select public.build_welcome_insights();$$);

-- Barrier: the facts must be today's (or yesterday's while tonight's build has not run) and plentiful.
create or replace function public.mon_detect_welcome_insights_stale()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; live text[] := '{}'; last_day date; kinds int; rows_ int;
begin
  select max(day) into last_day from public.welcome_insight;
  select count(distinct kind), count(*) into kinds, rows_ from public.welcome_insight where day = last_day;
  if last_day is null or last_day < (now() at time zone 'Asia/Riyadh')::date - 1 or kinds < 15 or rows_ < 200 then
    live := live || 'welcome_insights_stale:fleet'::text;
    n := n + public.mon_raise('P2', 'welcome_insights_stale', 'fleet', 'welcome_insights_stale:fleet',
      jsonb_build_object('last_day', last_day, 'kinds', kinds, 'rows', rows_,
        'why', 'The home headline''s daily insights are missing, old or thin, so signed-in users fall back to the plain headline.',
        'action', 'Check cron job build-welcome-insights and run select public.build_welcome_insights();'));
  end if;
  perform public.mon_resolve_stale_keys('welcome_insights_stale', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_welcome_insights_stale' in src) > 0 then return; end if;
  out_def := replace(src,
    E'    ''mon_detect_jazan_label_pin_far_north'',',
    E'    ''mon_detect_jazan_label_pin_far_north'',\n    ''mon_detect_welcome_insights_stale'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Proof: tonight's build runs now and yields many kinds, with the truth rules holding.
do $proof$
declare r int; k int; bad int;
begin
  r := public.build_welcome_insights();
  select count(distinct kind) into k from public.welcome_insight;
  if r < 200 or k < 15 then raise exception 'PROOF: only % insights in % kinds', r, k; end if;
  select count(*) into bad from public.welcome_insight where kind = 'rent_gap' and a < 2;
  if bad > 0 then raise exception 'PROOF: a rent gap below 2x'; end if;
  select count(*) into bad from public.welcome_insight w join public.loc_catalog_city c on c.city_id = w.city_id
   where w.kind in ('town_single', 'town_few')
     and regexp_replace(c.city_norm, '^حي\s+', '') in (select distinct regexp_replace(x.district_norm, '^حي\s+', '') from public.loc_catalog_district x);
  if bad > 0 then raise exception 'PROOF: a district spoke as a town'; end if;
end $proof$;
