-- EVERY PROPERTY PIN ON THE MAP (owner 2026-11-02: «display all property pins … Buy, Rent, Short stays … one golden
-- pin with the number when several listings share the exact same coordinates»). ONE read-only answer for the part of
-- the map on screen: `map_pins_ar()` takes the visible rectangle and returns either exact points (p_cell = 0 — every
-- listing on identical coordinates folded into one row with its count and ids) or grid cells with counts (p_cell > 0,
-- the zoomed-out bubbles). It never returns the whole index. Buy / Rent / Short stays come from deal_ar and the
-- standing rent_pool_ar() (Short stays = «شهري» = Gathern + Aqar Monthly); a point mixing deals is 'mixed'. A site's
-- registered default pin (ops_default_pin_register: its office printed as every ad's location) is NOT an exact pin —
-- those ads are shown at their city later — and p_poly (GeoJSON polygon) keeps only points strictly inside the shape
-- the user drew. Nothing is geocoded, nothing invented: a listing without a pin is not here.
create index if not exists idx_slar_pin on public.search_listings_ar (latitude, longitude)
  where latitude is not null and longitude is not null;

create or replace function public.map_pins_ar(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_cell double precision default 0, p_deals text[] default null, p_poly jsonb default null, p_limit integer default 3000)
returns table (lat double precision, lng double precision, n integer, deal text, type_ar text, platforms integer, ids jsonb)
language sql stable security definer
set search_path = public, extensions
as $$
  with base as (
    select s.source_table, s.listing_id, s.latitude::double precision la, s.longitude::double precision lo, s.type_ar, s.platform,
           case when s.deal_ar = 'بيع' then 'buy'
                when s.deal_ar = 'إيجار' and public.rent_pool_ar(s.platform, s.rent_period_ar) = 'شهري' then 'short'
                when s.deal_ar = 'إيجار' then 'rent' end as deal
    from public.search_listings_ar s
    where s.latitude is not null and s.longitude is not null
      and s.latitude between p_s and p_n and s.longitude between p_w and p_e
      and not exists (select 1 from public.ops_default_pin_register r
                       where r.source_table = s.source_table
                         and r.lat = round(s.latitude::numeric, 5) and r.lng = round(s.longitude::numeric, 5))
      and (p_poly is null or extensions.ST_Contains(
             extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON(p_poly::text), 4326),
             extensions.ST_SetSRID(extensions.ST_MakePoint(s.longitude::double precision, s.latitude::double precision), 4326)))
  ), kept as (
    select * from base where deal is not null and (p_deals is null or deal = any (p_deals))
  ), cells as (
    select case when p_cell > 0 then round((la / p_cell)::numeric) * p_cell else la end as ky,
           case when p_cell > 0 then round((lo / p_cell)::numeric) * p_cell else lo end as kx,
           la, lo, deal, type_ar, platform, source_table, listing_id
    from kept
  )
  select avg(la) as lat, avg(lo) as lng, count(*)::int as n,
         case when count(distinct deal) = 1 then min(deal) else 'mixed' end as deal,
         case when p_cell > 0 or count(*) > 1 then null else min(type_ar) end as type_ar,
         count(distinct platform)::int as platforms,
         case when p_cell > 0 then null
              else (select jsonb_agg(jsonb_build_object('t', c2.source_table, 'i', c2.listing_id))
                    from (select source_table, listing_id from cells c2 where c2.ky = c.ky and c2.kx = c.kx order by listing_id desc limit 100) c2) end as ids
  from cells c
  group by ky, kx
  order by n desc, ky, kx
  limit greatest(1, least(p_limit, 5000));
$$;
revoke all on function public.map_pins_ar(double precision, double precision, double precision, double precision, double precision, text[], jsonb, integer) from public;
grant execute on function public.map_pins_ar(double precision, double precision, double precision, double precision, double precision, text[], jsonb, integer) to anon, authenticated, service_role;

-- The definer-function rule (20261018 *_secdef_functions_are_not_a_public_api): an app-called definer keeps anon /
-- authenticated only through an allowlist row, or the next sweep revokes it and the map goes empty.
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason)
values ('map_pins_ar', '{anon,authenticated}', 'map: the pins (or count cells) inside the visible rectangle of the map, grouped by identical coordinates with counts and listing ids (src/data/mapPins.ts). Read-only STABLE over the served index; capped at 5,000 rows; no personal data.')
on conflict do nothing;
