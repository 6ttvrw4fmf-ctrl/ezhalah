-- P1 SPEED (owner 2026-10-23, «it takes so so long to load»): the loader's site list on every cold load.
--
-- loader_active_platforms_ar() (and loader_strip_platforms_ar(), which calls it) answered "which sites have
-- searchable rows" with array_agg(DISTINCT platform) over all of search_listings_ar — a full scan of
-- ~24,600 blocks / 405k rows to return ~150 names. pg_stat_statements: 24,972 + 7,085 calls, mean 322 / 290 ms,
-- max 6.2 s; measured live on a phone at 20:43 UTC: 5.8 s and 1.6 s on the first screen.
--
-- Now: an index on platform, and the same answer read by a skip scan (next platform after the previous one,
-- ~150 index probes). Still computed live on every call — no table to refresh, no cron, nothing to go stale.
-- platform > '' is exactly «platform is not null and platform <> ''».
-- Proved before apply on production: the new query's array = the old function's array (149 platforms).
create index if not exists idx_slar_platform on public.search_listings_ar (platform);

create or replace function public.loader_active_platforms_ar()
 returns text[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with recursive p(platform) as (
    (select s.platform from public.search_listings_ar s where s.platform > '' order by s.platform limit 1)
    union all
    select (select s.platform from public.search_listings_ar s where s.platform > p.platform order by s.platform limit 1)
      from p where p.platform is not null
  )
  select coalesce(array_agg(p.platform order by p.platform) filter (where p.platform is not null), '{}'::text[]) from p;
$function$;

-- Apply-time proof: the same answer as the old full-scan definition, in this transaction.
do $chk$
begin
  if public.loader_active_platforms_ar() is distinct from
     (select coalesce(array_agg(distinct platform order by platform), '{}'::text[])
        from public.search_listings_ar where platform is not null and platform <> '') then
    raise exception 'loader_active_platforms_ar: the skip scan disagrees with the full scan — rolling back';
  end if;
end
$chk$;
