-- THE HEADLINE'S FACTS MUST BE TRUE (owner 2026-10-22, after catching «المحمدية في منطقة الرياض فيها إعلان واحد فقط»).
-- That one ialqarawi ad is in a DISTRICT named المحمدية (its pin is in Qassim) but was filed under the Riyadh-region
-- TOWN of that name. Two guards were too weak, both now stronger:
--   1. "is it really a town" compared names with «حي» stripped but not «ال» («محمديه» never met «المحمديه»);
--   2. a town fact now also needs every pinned ad of the town to sit in the town's own region — nearer that region's
--      own listings than any other region's. One ad pinned elsewhere drops the town's facts.
-- And the two town lines say «على إزهله»: a count of OUR listings, never a claim about the whole market.
set local statement_timeout = '5min';

update public.welcome_template set
  ar = '{g} {n}، تدري إن عدد إعلانات {city} في {region} على إزهله {a} فقط، وأغلبها {type}؟ اكتشفها مع إزهله.',
  en = '{g} {n}, did you know {city} in {region} has only {a} listings on Ezhalah, mostly {type}? Discover it with Ezhalah.'
 where id = 1;
update public.welcome_template set
  ar = '{g} {n}، تدري إن {city} في {region} فيها إعلان واحد فقط على إزهله، وهو {type}؟ اكتشفه مع إزهله.',
  en = '{g} {n}, did you know {city} in {region} has just one listing on Ezhalah, a {type}? Discover it with Ezhalah.'
 where id = 2;

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
  drop table if exists w_b, w_dname, w_town, w_rent, w_rc, w_misplaced;
  create temp table w_b on commit drop as
    select s.source_table, s.listing_id, s.platform, s.region_ar, s.city_ar, s.city_id, nullif(nullif(trim(s.district_ar), ''), 'غير معروف') district_ar,
           s.deal_ar, s.type_ar, s.price_annual, s.price_total, s.price_per_meter, s.area_m2, s.furnished, s.property_age,
           s.maid_room, s.pool, s.payment_monthly, s.rent_now_pay_later, s.first_seen_at, s.latitude::float8 lat, s.longitude::float8 lng
      from public.search_listings_ar s
     where s.production_ready and s.city_ar is not null and s.city_ar <> 'غير معروف' and s.region_ar is not null;
  -- each region's centre = the median of its own pins; an ad belongs to the region whose centre is nearest
  create temp table w_rc on commit drop as
    select region_ar, percentile_cont(0.5) within group (order by lat) clat, percentile_cont(0.5) within group (order by lng) clng
      from w_b where lat is not null and lng is not null group by region_ar having count(*) >= 30;
  create temp table w_misplaced on commit drop as
    select distinct b.city_id from w_b b
     where b.lat is not null and b.lng is not null and b.city_id is not null
       and (select r.region_ar from w_rc r order by power(b.lat - r.clat, 2) + power((b.lng - r.clng) * cos(radians(r.clat)), 2) limit 1) <> b.region_ar;
  -- a town: a catalogue city whose name is not also some city's district; never speaks through an adjudicated far pin
  create temp table w_dname on commit drop as
    select distinct regexp_replace(regexp_replace(x.district_norm, '^حي\s+', ''), '^ال', '') nm from public.loc_catalog_district x;
  create temp table w_town on commit drop as
    select c.city_id from public.loc_catalog_city c
     where regexp_replace(regexp_replace(c.city_norm, '^حي\s+', ''), '^ال', '') not in (select nm from w_dname where nm is not null)
       -- 2. every pinned ad of the town sits in the town's own region: its pin is nearer that region's
       --    listings than any other region's (an ad filed under the wrong same-name place fails here)
       and c.city_id not in (select city_id from w_misplaced);

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


do $proof$
declare r int; bad int;
begin
  r := public.build_welcome_insights();
  if r < 200 then raise exception 'PROOF: only % insights after the rebuild', r; end if;
  if exists (select 1 from public.welcome_insight where kind in ('town_single','town_few') and city_ar = 'المحمدية') then
    raise exception 'PROOF: the district المحمدية still speaks as a town';
  end if;
  select count(*) into bad from public.welcome_insight w join public.loc_catalog_city c on c.city_id = w.city_id
   where w.kind in ('town_single','town_few')
     and regexp_replace(regexp_replace(c.city_norm, '^حي\s+', ''), '^ال', '')
         in (select regexp_replace(regexp_replace(x.district_norm, '^حي\s+', ''), '^ال', '') from public.loc_catalog_district x);
  if bad > 0 then raise exception 'PROOF: % district names still speak as towns', bad; end if;
end $proof$;
