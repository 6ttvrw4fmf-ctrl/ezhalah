-- MAP: A LISTING WITH NO PIN BORROWS ITS TWIN'S PIN — ONLY WHEN WE ARE SURE IT IS THE SAME PROPERTY
-- (owner 2026-11-09: «make it a rule»; «just match the ones that you are confident about — if something doesn't match,
-- keep them on a side»).
--
-- ~15,900 listings have no map pin because their website never says where the property is (checked on the 8 biggest
-- sites 2026-11-09: no map on the ad, or only the agency's office map). Some of them are the SAME property another site
-- published WITH a pin. Those borrow that pin, hourly, so new listings follow the same rule. Two ways to be sure:
--   1. the same government ad licence number (رقم ترخيص الإعلان) in the same city;
--   2. the same city, district, deal, type, size and bedrooms (price may differ), NO other detail both ads give
--      disagrees (bathrooms, halls, floor, age ±1, street width, facing, street fronts), at least two of those agree,
--      and at most 10 look-alikes to choose from.
-- Either way every matching twin must sit on ONE spot (within ~150 m); twins in two places → no pin. Anything short
-- of that stays without a pin (still in search). Map only: the listing's own data is untouched (source = truth), the
-- pin coverage monitors still measure what sites published, and a borrowed pin lands on its twin's drawn spot, so the
-- two show as one pin with separate cards.

create table if not exists public.map_pin_borrow (
  source_table text not null,
  listing_id bigint not null,
  lat numeric not null,
  lng numeric not null,
  rule text not null check (rule in ('licence', 'details')),
  donor_table text not null,
  donor_id bigint not null,
  refreshed_at timestamptz not null default now(),
  primary key (source_table, listing_id)
);
create index if not exists map_pin_borrow_lat_lng on public.map_pin_borrow (lat, lng);
alter table public.map_pin_borrow enable row level security;
revoke all on public.map_pin_borrow from anon, authenticated;

create or replace function public.map_pin_borrow_refresh_ar()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer := 0;
begin
  create temp table map_pin_borrow_new on commit drop as
  with np as materialized (
    select x.source_table, x.listing_id, x.city_id, x.district_norm_tok d, x.deal_ar, x.type_ar, x.area_m2 a, coalesce(x.bedrooms, -1) b,
           x.bathrooms ba, x.living_rooms lr, x.floor_number fl, x.property_age ag, x.street_width_m sw, x.direction_ar dir, x.frontage_count fc,
           case when x.license_number ~ '^[0-9]{6,}$' then x.license_number end lic
    from public.search_listings_ar x
    where x.latitude is null or x.longitude is null
  ), pin as materialized (
    select x.source_table, x.listing_id, x.city_id, x.district_norm_tok d, x.deal_ar, x.type_ar, x.area_m2 a, coalesce(x.bedrooms, -1) b,
           x.bathrooms ba, x.living_rooms lr, x.floor_number fl, x.property_age ag, x.street_width_m sw, x.direction_ar dir, x.frontage_count fc,
           case when x.license_number ~ '^[0-9]{6,}$' then x.license_number end lic,
           coalesce(sn.lat, x.latitude::double precision) la, coalesce(sn.lng, x.longitude::double precision) lo
    from public.search_listings_ar x
    left join public.map_pin_snap sn on sn.source_table = x.source_table and sn.listing_id = x.listing_id
      and abs(sn.lat - x.latitude::double precision) < 0.01 and abs(sn.lng - x.longitude::double precision) < 0.01
    where x.latitude is not null and x.longitude is not null
      and not exists (select 1 from public.ops_default_pin_register r
                       where r.source_table = x.source_table and r.lat = round(x.latitude::numeric, 5) and r.lng = round(x.longitude::numeric, 5))
  ), by_licence as (
    -- Rule 1: the same government ad licence number (رقم ترخيص الإعلان) in the same city = the same property.
    select np.source_table, np.listing_id, p.source_table dt, p.listing_id di, p.la, p.lo, 'licence'::text rule
    from np join pin p on p.lic = np.lic and p.city_id = np.city_id
    where np.lic is not null
  ), detail_pairs as (
    -- Rule 2: same city, district, deal, type, size and bedrooms (price may differ) …
    select np.source_table, np.listing_id, p.source_table dt, p.listing_id di, p.la, p.lo,
           count(*) over (partition by np.source_table, np.listing_id) k,
           coalesce((np.ba <> p.ba)::int, 0) + coalesce((np.lr <> p.lr)::int, 0) + coalesce((np.fl <> p.fl)::int, 0)
         + coalesce((abs(np.ag - p.ag) > 1)::int, 0) + coalesce((np.sw <> p.sw)::int, 0) + coalesce((np.dir <> p.dir)::int, 0)
         + coalesce((np.fc <> p.fc)::int, 0) conflicts,
           coalesce((np.ba = p.ba)::int, 0) + coalesce((np.lr = p.lr)::int, 0) + coalesce((np.fl = p.fl)::int, 0)
         + coalesce((abs(np.ag - p.ag) <= 1)::int, 0) + coalesce((np.sw = p.sw)::int, 0) + coalesce((np.dir = p.dir)::int, 0)
         + coalesce((np.fc = p.fc)::int, 0) agrees
    from np join pin p on p.city_id = np.city_id and p.d = np.d and p.deal_ar = np.deal_ar and p.type_ar = np.type_ar
                      and p.a = np.a and p.b = np.b
    where np.a > 0 and np.d <> ''
  ), by_details as (
    -- … and NO detail both ads give disagrees, and at least two more details agree.
    select source_table, listing_id, dt, di, la, lo, 'details'::text rule
    from detail_pairs dp
    where k <= 10 and conflicts = 0 and agrees >= 2
      and not exists (select 1 from by_licence l where l.source_table = dp.source_table and l.listing_id = dp.listing_id)
  ), cand as (
    select * from by_licence union all select * from by_details
  ), one_spot as (
    -- Every matching twin must sit on ONE spot (within ~150 m); twins in two places → no pin (we cannot tell which).
    select source_table, listing_id from cand group by 1, 2
    having max(la) - min(la) <= 0.0015 and max(lo) - min(lo) <= 0.0015
  )
  select distinct on (c.source_table, c.listing_id) c.source_table, c.listing_id, c.la::numeric lat, c.lo::numeric lng, c.rule, c.dt, c.di
  from cand c join one_spot o using (source_table, listing_id)
  order by c.source_table, c.listing_id, c.dt, c.di
;
  delete from public.map_pin_borrow;
  insert into public.map_pin_borrow (source_table, listing_id, lat, lng, rule, donor_table, donor_id)
  select source_table, listing_id, lat, lng, rule, dt, di from map_pin_borrow_new;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.map_pin_borrow_refresh_ar() from public, anon, authenticated;

-- What the map draws: every listing with its own pin, plus the borrowed ones.
create or replace view public.map_listing_points_ar as
  select s.source_table, s.listing_id, s.latitude, s.longitude, s.type_ar, s.platform, s.deal_ar, s.rent_period_ar,
         s.price_total, s.price_annual, s.bedrooms, s.area_m2, s.city_ar, s.district_ar, s.region_ar
  from public.search_listings_ar s
  where s.latitude is not null and s.longitude is not null
  union all
  select s.source_table, s.listing_id, b.lat, b.lng, s.type_ar, s.platform, s.deal_ar, s.rent_period_ar,
         s.price_total, s.price_annual, s.bedrooms, s.area_m2, s.city_ar, s.district_ar, s.region_ar
  from public.map_pin_borrow b
  join public.search_listings_ar s on s.source_table = b.source_table and s.listing_id = b.listing_id
  where s.latitude is null or s.longitude is null;
revoke all on public.map_listing_points_ar from anon, authenticated;

-- The pins and the hourly grid/labels read that view instead of the bare index (every listing read; the short-stay
-- pool reads stay on the index). Needle edit with a count check, so a changed body fails loudly instead of half-applying.
do $do$
declare
  d text;
  needle constant text := E'from public.search_listings_ar s\n';
  n integer;
begin
  d := pg_get_functiondef('public.map_pins_ar(double precision, double precision, double precision, double precision, double precision, text[], jsonb, integer, text, text[], integer[], integer, integer, numeric, numeric)'::regprocedure);
  n := (length(d) - length(replace(d, needle, ''))) / length(needle);
  if n <> 4 then raise exception 'map_pins_ar: expected 4 listing reads, found %', n; end if;
  execute replace(d, needle, E'from public.map_listing_points_ar s\n');

  d := pg_get_functiondef('public.map_grid_refresh_ar()'::regprocedure);
  n := (length(d) - length(replace(d, needle, ''))) / length(needle);
  if n <> 1 then raise exception 'map_grid_refresh_ar: expected 1 listing read, found %', n; end if;
  execute replace(d, needle, E'from public.map_listing_points_ar s\n');
end
$do$;

-- Hourly at :47, before the grid (:53) so the labels count the borrowed pins too.
select cron.schedule('map-pin-borrow-refresh', '47 * * * *',
  $cron$set statement_timeout to '120s'; select public.map_pin_borrow_refresh_ar();$cron$);

select public.map_pin_borrow_refresh_ar();
