-- The scale stats count EVERY listing in the index, not only production_ready ones
-- (owner 2026-10-20: «the numbers should be the same» — the WhatsApp card said 393,859 while the
-- index holds 407,143; 12,379 of the difference are dwelleo's listings, held while the platform is
-- dormant, the rest rows without a readable city). One number now feeds the card (middleware.ts,
-- api/share-card.ts), the search loader's «نتحقق من N إعلان» line and the Filter home's welcome
-- line, all through loader_scale_stats_ar().
--
-- A NEW view, and the function re-pointed at it: dropping the served view needs an exclusive lock
-- that two attempts could not get within the tool's 60 s (2026-10-20 15:5x and 16:1x UTC, nothing
-- applied either time). The old loader_scale_stats_mv stays until a quiet-hour follow-up drops it;
-- the hourly cron refresh-loader-scale-stats now refreshes the new view (CONCURRENTLY, so the unique
-- index on id is required).
set local lock_timeout = '15s';
create materialized view public.loader_scale_stats_total_mv as
  select 1 as id,
         (count(*))::integer as listing_count,
         (count(distinct city_id))::integer as city_count,
         (count(distinct row(city_id, norm_district_tok(district_ar)))
            filter (where district_ar is not null and district_ar <> ''))::integer as district_count
  from public.search_listings_ar;
create unique index loader_scale_stats_total_mv_id on public.loader_scale_stats_total_mv using btree (id);
create or replace function public.loader_scale_stats_ar()
 returns table(listing_count integer, city_count integer, district_count integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select listing_count, city_count, district_count from public.loader_scale_stats_total_mv;
$function$;
select cron.alter_job(
  (select jobid from cron.job where jobname = 'refresh-loader-scale-stats'),
  command := 'refresh materialized view concurrently public.loader_scale_stats_total_mv'
);
