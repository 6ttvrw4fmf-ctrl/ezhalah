-- City centres, coarse points and proven agent defaults are not a property's pin (mapping audit, 2026-10-21).
--
-- The audit of every served pin (369,766) found three kinds of point the shared-default rule could not see,
-- because each sits in ONE district or on too few ads:
--   1. A city's own default centre, e.g. 24.7136,46.6753 (Google's «Riyadh»): 12 served pins (alsaedan 3,
--      ksaaqar 8, sakan 1). alsaedan unit 3282's page publishes exactly that pair.
--   2. Coarse points, ≤ 2 decimals on either axis (±1 km at best): 124 served pins (sirdab 59, aqar 41 incl.
--      7 ads on exactly 24.0,46.0, haraj 13, …). The source rounded them; they are an area, not a pin.
--   3. Agent default points proven by the ads themselves (different properties, different districts or towns,
--      one point): ksaaqar 17.15480,42.62690 (6 Sabya-area ads incl. one in Bish), 21.76309,39.16424 (5 Jeddah
--      flats in different districts), 21.52915,39.16109 (8: chalets, warehouses, a villa); haraj 28.46593,
--      36.56699 (9 Tabuk ads in الشفا/البوادي/الصفا/الحمراء); eaqartabuk 28.36512,36.47804 and 28.35168,36.51134
--      (one point per district on land, villas and flats alike); nawafeth 27.01950,49.57280 and 27.01960,49.57320 (its Jubail
--      point on ads in Makkah, Jeddah, Dammam, Buqayq and Dukhnah).
-- Legitimate shared points are NOT touched: one building or one project (nofodh «AMGP-BLK10-58», alsaedan
-- «KHR-DM11-AP-A12», bossbih «المحدود (249/4) ب/ج», wahadat «الماجدية 174») keeps its pin.
--
-- Mechanism: the existing hourly strip (:15) and its reject trigger. shared_default_pins() now also returns
-- (1) and (2); (3) is registered once here with its evidence. Reversible: delete the register row and the next
-- crawl writes the pin back (the trigger only strips a REGISTERED pair).
--
-- The strip used to run one UPDATE per registered point, each a full scan of the platform's table. That was
-- cheap with 18 points on small tables; the coarse rule registers ~40 points on aqar (1.2 GB). It now finds the
-- rows through the served index and updates them by primary key, one statement per table.

create table if not exists public.ops_city_centre_point (
  name text primary key,
  lat numeric(9,5) not null,
  lng numeric(9,5) not null
);
comment on table public.ops_city_centre_point is
  'Default map centres of Saudi cities (what a map shows before anyone drops a pin). A served pin on one of them is not a property location; shared_default_pins() returns it (mapping audit 2026-10-21).';
insert into public.ops_city_centre_point (name, lat, lng) values
  ('Riyadh', 24.71360, 46.67530), ('Jeddah', 21.48580, 39.19250), ('Makkah', 21.38910, 39.85790),
  ('Madinah', 24.52470, 39.56920), ('Madinah (2)', 24.46720, 39.60240), ('Dammam', 26.42070, 50.08880),
  ('Khobar', 26.21720, 50.19710), ('Taif', 21.27030, 40.41580), ('Tabuk', 28.38350, 36.56620),
  ('Abha', 18.24650, 42.51170), ('Buraidah', 26.32600, 43.97500), ('Hofuf', 25.36470, 49.58610),
  ('Jazan', 16.88920, 42.55110), ('Hail', 27.51140, 41.72080), ('Najran', 17.56560, 44.22890),
  ('Khamis Mushait', 18.30000, 42.73330), ('Jubail', 27.00460, 49.64600), ('Yanbu', 24.08950, 38.06180),
  ('Al Kharj', 24.15560, 47.33460), ('Qatif', 26.51960, 50.01150), ('Saudi Arabia', 23.88590, 45.07920)
on conflict (name) do nothing;

create or replace function public.shared_default_pins(p_min_ads int default 5, p_min_districts int default 3)
returns table(source_table text, platform text, lat numeric, lng numeric, ads bigint, districts bigint)
language sql stable as $$
  with shared as (
    select s.source_table, s.platform,
           round(s.latitude::numeric, 5) lat, round(s.longitude::numeric, 5) lng,
           count(*) ads, count(distinct s.district_ar) districts
      from public.search_listings_ar s
     where s.latitude is not null and s.longitude is not null and s.district_ar is not null
     group by 1, 2, 3, 4
    having count(*) >= p_min_ads and count(distinct s.district_ar) >= p_min_districts),
  centre as (   -- (1) a city's default map centre
    select s.source_table, s.platform, round(s.latitude::numeric, 5) lat, round(s.longitude::numeric, 5) lng,
           count(*) ads, count(distinct s.district_ar) districts
      from public.search_listings_ar s
      join public.ops_city_centre_point c
        on abs(s.latitude::numeric - c.lat) < 0.00006 and abs(s.longitude::numeric - c.lng) < 0.00006
     group by 1, 2, 3, 4),
  coarse as (   -- (2) ≤ 2 decimals on either axis: an area, not a pin
    select s.source_table, s.platform, round(s.latitude::numeric, 5) lat, round(s.longitude::numeric, 5) lng,
           count(*) ads, count(distinct s.district_ar) districts
      from public.search_listings_ar s
     where s.latitude is not null and s.longitude is not null
       and (round(s.latitude::numeric, 2) = s.latitude::numeric or round(s.longitude::numeric, 2) = s.longitude::numeric)
     group by 1, 2, 3, 4)
  select * from shared union select * from centre union select * from coarse
  order by 5 desc;
$$;
comment on function public.shared_default_pins(int, int) is
  'Points that are not a property pin: shared by ≥5 ads across ≥3 districts (owner 2026-10-19), a city''s default centre (ops_city_centre_point), or ≤2 decimals on either axis (mapping audit 2026-10-21).';

create or replace function public.strip_shared_default_pins() returns integer
language plpgsql security definer set search_path to 'public' as $$
declare r record; n int; total int := 0;
begin
  for r in select * from public.shared_default_pins() loop
    insert into public.ops_default_pin_register (source_table, lat, lng, ads, districts)
    values (r.source_table, r.lat, r.lng, r.ads, r.districts)
    on conflict (source_table, lat, lng) do update
      set ads = excluded.ads, districts = excluded.districts, last_seen_at = now();
  end loop;
  for r in select distinct g.source_table from public.ops_default_pin_register g loop
    if not exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = r.source_table and c.column_name = 'additional_info') then
      continue;
    end if;
    if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                    where c.relname = r.source_table and t.tgname = 'reject_registered_default_pin') then
      execute format('create trigger reject_registered_default_pin before insert or update on public.%I
                      for each row execute function public.tg_reject_registered_default_pin()', r.source_table);
    end if;
    execute format(
      $q$update public.%I t set additional_info = t.additional_info - 'latitude' - 'longitude' - 'lat' - 'lng'
           from (select s.listing_id from public.search_listings_ar s
                   join public.ops_default_pin_register g
                     on g.source_table = s.source_table
                    and g.lat = round(s.latitude::numeric, 5) and g.lng = round(s.longitude::numeric, 5)
                  where s.source_table = %L) hit
          where t.id = hit.listing_id
            and coalesce(t.additional_info->>'latitude', t.additional_info->>'lat') ~ '^-?[0-9]+(\.[0-9]+)?$'
            and coalesce(t.additional_info->>'longitude', t.additional_info->>'lng') ~ '^-?[0-9]+(\.[0-9]+)?$'
            and exists (select 1 from public.ops_default_pin_register g
                         where g.source_table = %L
                           and g.lat = round(coalesce(t.additional_info->>'latitude', t.additional_info->>'lat')::numeric, 5)
                           and g.lng = round(coalesce(t.additional_info->>'longitude', t.additional_info->>'lng')::numeric, 5))$q$,
      r.source_table, r.source_table, r.source_table);
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  return total;
end $$;
comment on function public.strip_shared_default_pins() is
  'Registers every non-pin point (shared_default_pins: shared default, city centre, coarse), attaches the reject trigger, and strips the pair from the SERVED rows by primary key. Hourly at :15, before the :22 index sync.';

-- (3) Agent default points proven by the ads on them (evidence in the header).
insert into public.ops_default_pin_register (source_table, lat, lng, ads, districts) values
  ('ksaaqar_residential_listings', 17.15480, 42.62690, 6, 2),
  ('ksaaqar_residential_listings', 21.76309, 39.16424, 5, 2),
  ('ksaaqar_residential_listings', 21.52915, 39.16109, 8, 1),
  ('haraj_residential_listings', 28.46593, 36.56699, 9, 2),
  ('eaqartabuk_residential_listings', 28.36512, 36.47804, 9, 1),
  ('eaqartabuk_residential_listings', 28.35168, 36.51134, 8, 1),
  -- nawafeth's own point in Jubail, printed on ads in مكة المكرمة / جدة / الدمام / بقعاء / دخنة (6 ads, 5 cities)
  ('nawafeth_residential_listings', 27.01950, 49.57280, 3, 3),
  ('nawafeth_residential_listings', 27.01960, 49.57320, 3, 3)
on conflict (source_table, lat, lng) do update set last_seen_at = now();

do $proof$
declare before_n int; stripped int; unregistered int;
begin
  select count(*) into before_n from public.ops_default_pin_register;
  stripped := public.strip_shared_default_pins();
  if stripped = 0 then raise exception 'PROOF: nothing was stripped'; end if;
  select count(*) into unregistered from public.shared_default_pins() d
    where not exists (select 1 from public.ops_default_pin_register r
                       where r.source_table = d.source_table and r.lat = d.lat and r.lng = d.lng);
  if unregistered > 0 then raise exception 'PROOF: % default/coarse points were not registered', unregistered; end if;
  raise notice 'register % → %, stripped % rows', before_n, (select count(*) from public.ops_default_pin_register), stripped;
end $proof$;
