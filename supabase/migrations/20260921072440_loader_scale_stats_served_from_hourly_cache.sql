-- LOADER SCALE STATS, SERVED FROM AN HOURLY CACHE (2026-09-21).
--
-- loader_scale_stats_ar() feeds three marketing numbers on the search loader (listings / cities /
-- districts covered). It took no arguments, so every user on every search got the same answer — yet
-- it recomputed it from scratch each time: all ~225k production_ready rows of search_listings_ar,
-- with norm_district_tok() (8 regexp_replace + normalize_ar) per row inside a count(distinct).
-- Measured on production: mean 4.3 s over 7,214 calls, worst 19.9 s, 11.8-15.0 s on live searches —
-- and it ran on every loader mount, at the same moment as the search the user was waiting on,
-- competing with it for the same database.
--
-- The answer can only change when search_listings_ar changes, which is the hourly sync (cron job 28,
-- '22 * * * *', worst run ~9.6 min). So it is computed once an hour, a safe margin after that sync
-- (':35'), and the function reads the stored row. Same name, same signature, same three columns,
-- same SECURITY DEFINER / search_path — the client is untouched, and the SELECT is the function's own
-- body verbatim, so the numbers mean exactly what they meant before; they are at most ~1 h old.

create materialized view if not exists public.loader_scale_stats_mv as
  select
    1 as id,
    count(*)::int as listing_count,
    count(distinct city_id)::int as city_count,
    count(distinct (city_id, norm_district_tok(district_ar)))
      filter (where district_ar is not null and district_ar <> '')::int as district_count
  from public.search_listings_ar
  where production_ready = true;

-- REFRESH ... CONCURRENTLY needs a unique index; a reader never sees an empty stats row mid-refresh.
create unique index if not exists loader_scale_stats_mv_id on public.loader_scale_stats_mv (id);

-- Not part of the public API: the SECURITY DEFINER function below is the only reader.
revoke all on public.loader_scale_stats_mv from anon, authenticated;

create or replace function public.loader_scale_stats_ar()
 returns table(listing_count integer, city_count integer, district_count integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select listing_count, city_count, district_count from public.loader_scale_stats_mv;
$function$;

select cron.schedule(
  'refresh-loader-scale-stats',
  '35 * * * *',
  $cron$refresh materialized view concurrently public.loader_scale_stats_mv$cron$
);
