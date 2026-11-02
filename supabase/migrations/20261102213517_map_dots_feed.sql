-- THE DOTS FEED (2026-11-02; owner: «can you do it in a way that even when I am zoomed out they all show?»). Every
-- listing's spot, at any zoom, painted on a canvas: the finest precomputed cell (0.01° ≈ 1 km — at the country view a
-- cell is one pixel, so a cell IS the listing's spot) for every pinned listing, as one compact array the map downloads
-- once per session and paints client-side. 23,007 cells cover all 424,705 listings (measured at build time). Rebuilt
-- hourly with map_grid_ar (map_grid_refresh_ar). Rows: [lat, lng, deal, n] with deal 0 = buy, 1 = rent, 2 = short.
create or replace function public.map_dots_ar()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(round(g.lat::numeric, 4), round(g.lng::numeric, 4),
                                               case g.deal when 'buy' then 0 when 'rent' then 1 else 2 end, g.n)
                            order by g.ki, g.kj, g.deal), '[]'::jsonb)
  from public.map_grid_ar g
  where g.cell = 0.01;
$$;
grant execute on function public.map_dots_ar() to anon, authenticated;
insert into public.ops_public_secdef_allowlist (proname, grant_to, reason)
values ('map_dots_ar', '{anon,authenticated}', 'map: every listing''s 1 km spot with its deal, one compact array painted on a canvas at any zoom (src/data/mapDots.ts); rebuilt hourly with map_grid_ar')
on conflict do nothing;
comment on function public.map_dots_ar() is 'Every pinned listing''s 0.01° cell as [lat, lng, deal(0 buy/1 rent/2 short), n]; the map paints them all on a canvas when zoomed out.';
