-- MAP: LISTINGS WITH NO EXACT LOCATION SHOW AS ONE DISTRICT MARKER (owner 2026-11-09: «include the ones with no
-- pins … make it professional … «موقع غير محدد» / «No exact location» … when the user clicks he sees them»).
--
-- ~13,500 listings name their district but their website never says where the property is (checked on the 8 biggest
-- sites 2026-11-09), and no sure twin lends them a pin (map_pin_borrow). From district zoom inward the map draws ONE
-- marker per district for them, at the district's centre (the median of the district's PINNED listings, the same
-- centre the district label uses), dark purple with a crossed-out pin and the tag «موقع غير محدد», so nobody reads it
-- as a house's spot. A tap opens the same card sheet a pin opens. The blue pins, the dots feed, the area labels and
-- the count pill are untouched: a real spot stays a real spot. A district with no pinned listing has no centre and
-- stays search-only; so does a listing that names only its city.
--
-- map_nopin_ar holds those listings with their district centre and the fields the map's filter needs (deal, price,
-- size, type, bedrooms); map_nopin_refresh_ar() rebuilds it hourly, inside the map job right after the grid (which
-- refreshes the centres). map_nopin_markers_ar() is what the map reads: one row per district inside the view, with the
-- count and the card ids, in milliseconds (12k rows, indexed by centre).

create table if not exists public.map_nopin_ar (
  source_table text not null,
  listing_id bigint not null,
  city text not null,
  district text not null,
  lat double precision not null,
  lng double precision not null,
  deal text not null,
  price numeric,
  area integer,
  type_ar text,
  beds integer,
  refreshed_at timestamptz not null default now(),
  primary key (source_table, listing_id)
);
create index if not exists map_nopin_ar_centre on public.map_nopin_ar (lat, lng);
alter table public.map_nopin_ar enable row level security;
revoke all on public.map_nopin_ar from anon, authenticated;

-- The no-pin rows are 3% of the index; the refresh must not scan the other 97%.
create index if not exists idx_slar_no_pin on public.search_listings_ar (city_ar, district_ar)
  where latitude is null or longitude is null;

create or replace function public.map_nopin_refresh_ar()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_short text[];
  v_n integer := 0;
begin
  select coalesce(array_agg(p.k), '{}') into v_short from public.map_short_pairs_ar p;
  create temp table map_nopin_new on commit drop as
  with ctr as (
    -- The district's centre: its pinned listings' median (map_area_ar, refreshed by the grid a moment earlier),
    -- weighted over the deals. No pinned listing → no centre → the district's no-pin listings stay search-only.
    select a.city, a.district, sum(a.lat * a.n) / sum(a.n) lat, sum(a.lng * a.n) / sum(a.n) lng
    from public.map_area_ar a
    where a.level = 'district'
    group by a.city, a.district
  )
  select s.source_table, s.listing_id, c.city, c.district, c.lat, c.lng,
         case when s.deal_ar = 'بيع' then 'buy'
              when s.deal_ar = 'إيجار' and (s.platform || '|' || coalesce(s.rent_period_ar, '')) = any (v_short) then 'short'
              when s.deal_ar = 'إيجار' then 'rent' end as deal,
         case when s.deal_ar = 'بيع' then s.price_total else s.price_annual end as price,
         s.area_m2 area, s.type_ar, s.bedrooms beds
  from public.search_listings_ar s
  join ctr c on c.city = btrim(s.city_ar) and c.district = btrim(s.district_ar)
  where (s.latitude is null or s.longitude is null)
    -- A listing that borrowed its sure twin's pin is already on the map at that pin.
    and not exists (select 1 from public.map_pin_borrow b where b.source_table = s.source_table and b.listing_id = s.listing_id)
    and s.deal_ar in ('بيع', 'إيجار');
  delete from public.map_nopin_ar;
  insert into public.map_nopin_ar (source_table, listing_id, city, district, lat, lng, deal, price, area, type_ar, beds)
  select source_table, listing_id, city, district, lat, lng, deal, price, area, type_ar, beds from map_nopin_new;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.map_nopin_refresh_ar() from public, anon, authenticated;

-- What the map reads: one marker per district whose centre is inside the view, under the same filter the pins take.
-- A drawn boundary (p_poly in map_pins_ar) has no counterpart here: a listing with no spot cannot be inside a shape,
-- so the map does not ask while a boundary is applied.
create or replace function public.map_nopin_markers_ar(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_deals text[] default null, p_category text default null, p_types text[] default null, p_beds integer[] default null,
  p_area_min integer default null, p_area_max integer default null, p_price_min numeric default null, p_price_max numeric default null,
  p_limit integer default 200)
returns table(city text, district text, lat double precision, lng double precision, n integer, deal text, ids jsonb)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select m.city, m.district, m.lat, m.lng, count(*)::int,
         case when count(distinct m.deal) = 1 then min(m.deal) else 'mixed' end,
         to_jsonb((array_agg(jsonb_build_object('t', m.source_table, 'i', m.listing_id) order by m.listing_id desc))[1:500])
  from public.map_nopin_ar m
  where m.lat between p_s and p_n and m.lng between p_w and p_e
    and (p_deals is null or m.deal = any (p_deals))
    and (p_category is null or (p_category = 'residential' and m.source_table like '%\_residential\_%')
                            or (p_category = 'commercial' and m.source_table like '%\_commercial\_%'))
    and (p_types is null or m.type_ar = any (p_types))
    and (p_beds is null or m.beds = any (p_beds))
    and (p_area_min is null or m.area >= p_area_min) and (p_area_max is null or m.area <= p_area_max)
    and (p_price_min is null or m.price >= p_price_min) and (p_price_max is null or m.price <= p_price_max)
  group by m.city, m.district, m.lat, m.lng
  order by 5 desc
  limit greatest(1, least(p_limit, 1000));
$function$;
grant execute on function public.map_nopin_markers_ar(double precision, double precision, double precision, double precision, text[], text, text[], integer[], integer, integer, numeric, numeric, integer) to anon, authenticated, service_role;

-- Hourly, inside the map job, after the grid refreshes the district centres.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'map_grid_refresh_ar'),
  command := $cron$set statement_timeout to '300s'; select public.map_pin_borrow_refresh_ar(); select public.map_grid_refresh_ar(); select public.map_nopin_refresh_ar();$cron$
);

select public.map_nopin_refresh_ar();
