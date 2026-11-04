-- EVERY CITY AND DISTRICT LABEL, ONCE PER VISIT (owner 2026-11-03: «can we make it faster and better, I want it to feel
-- smooth»). Measured in the browser that day: map_areas_ar() answered in 1 ms in the database but each zoom waited
-- ~300-420 ms for the network round trip, and a crowded zoom made three reads in a row (~1.2 s). This feed returns all
-- the labels at once (≈9.4k rows from map_area_ar, refreshed hourly) so the map filters them on the phone and a zoom
-- between city and district level needs no network at all. One compact row per label:
--   [is_city, city, district, lat, lng, n_buy, n_rent, n_short]   (position: weighted over the deals)
create or replace function public.map_areas_feed_ar()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(x.is_city, x.city, x.district, x.lat, x.lng, x.nb, x.nr, x.ns)), '[]'::jsonb)
  from (
    select a.level = 'city' as is_city, a.city, a.district,
           round((sum(a.lat * a.n) / sum(a.n))::numeric, 4) as lat, round((sum(a.lng * a.n) / sum(a.n))::numeric, 4) as lng,
           coalesce(sum(a.n) filter (where a.deal = 'buy'), 0) as nb,
           coalesce(sum(a.n) filter (where a.deal = 'rent'), 0) as nr,
           coalesce(sum(a.n) filter (where a.deal = 'short'), 0) as ns
    from public.map_area_ar a
    group by a.level, a.city, a.district
  ) x;
$$;
grant execute on function public.map_areas_feed_ar() to anon, authenticated;
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason)
values ('map_areas_feed_ar', '{anon,authenticated}', 'map: every city / district label with per-deal counts in one read per visit (src/data/mapAreas.ts), filtered on the phone so zooms need no network; built from map_area_ar (hourly)')
on conflict do nothing;
comment on function public.map_areas_feed_ar() is 'Map labels feed: every city and district with per-deal counts, one read per visit (map_area_ar).';
