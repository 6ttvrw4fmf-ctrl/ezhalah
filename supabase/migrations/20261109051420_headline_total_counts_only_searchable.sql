-- THE HEADLINE TOTAL COUNTS ONLY ADS A USER CAN FIND (owner 2026-11-09: «Yeah, please do that … I noticed that the
-- number sometimes is wrong»). Measured that morning: loader_scale_stats_ar() said 463,281 listings while search
-- (location_search_candidates_ar, af_eligible_count — both filter production_ready) could reach 462,476. The 805 extra
-- rows are not production_ready, almost all with no readable city (dealapp 90, wasalt 76, rakez 58, aqarcity 52 …), so
-- no search can return them. This supersedes the 2026-10-20 «count EVERY listing in the index» choice
-- (20261020164834); that decision's purpose — ONE number on the WhatsApp card, the search loader and the welcome line —
-- still holds, because all three read this one function.
--
-- A NEW view and the function re-pointed at it, the same no-exclusive-lock pattern 20261020164834 used. The hourly cron
-- refresh-loader-scale-stats now refreshes the new view (CONCURRENTLY, so the unique index on id is required). The old
-- view is left for a quiet-hour drop. Guard: scripts/verify-headline-total-counts-only-searchable.ts.
set local lock_timeout = '15s';
create materialized view public.loader_scale_stats_ready_mv as
  select 1 as id,
         (count(*))::integer as listing_count,
         (count(distinct city_id))::integer as city_count,
         (count(distinct row(city_id, norm_district_tok(district_ar)))
            filter (where district_ar is not null and district_ar <> ''))::integer as district_count
  from public.search_listings_ar
  where production_ready;
create unique index loader_scale_stats_ready_mv_id on public.loader_scale_stats_ready_mv using btree (id);
create or replace function public.loader_scale_stats_ar()
 returns table(listing_count integer, city_count integer, district_count integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select listing_count, city_count, district_count from public.loader_scale_stats_ready_mv;
$function$;
select cron.alter_job(
  (select jobid from cron.job where jobname = 'refresh-loader-scale-stats'),
  command := 'refresh materialized view concurrently public.loader_scale_stats_ready_mv'
);
do $$
declare v int; t int;
begin
  select listing_count into v from public.loader_scale_stats_ar();
  select count(*) into t from public.search_listings_ar where production_ready;
  if v <> t then raise exception 'headline total % <> searchable % after the switch', v, t; end if;
  if v >= (select count(*) from public.search_listings_ar) and exists (select 1 from public.search_listings_ar where not production_ready) then
    raise exception 'headline total still counts rows search cannot reach';
  end if;
end $$;
