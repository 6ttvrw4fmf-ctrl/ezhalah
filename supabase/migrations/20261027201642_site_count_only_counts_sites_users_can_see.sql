-- ONE RULE (owner 2026-10-27): «we hide their listings → we hide their logos, and the wording changes».
-- loader_active_platforms_ar() is THE site count (src/data/siteCount.ts: the welcome line, the share
-- sentence, the WhatsApp card) and, from this change, the logo strip's roster too. It used to list every
-- platform with ANY row in search_listings_ar, so the four dormant sites (almuteb, sadin, senan, snam),
-- whose rows stay in the index with production_ready = false, were counted while their ads were hidden:
-- 149 slugs → «148 منصة». Now a platform counts only when it is active in platform_registry AND has at
-- least one production_ready row, i.e. when a user can actually see one of its ads.
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
  select coalesce(array_agg(p.platform order by p.platform), '{}'::text[])
    from p
   where p.platform is not null
     and exists (select 1 from public.platform_registry r where r.platform = p.platform and r.status = 'active')
     and exists (select 1 from public.search_listings_ar s where s.platform = p.platform and s.production_ready);
$function$;
