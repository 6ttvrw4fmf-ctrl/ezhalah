-- Apply-time proof for 20261027201642 (owner 2026-10-27: hidden listings → hidden logo → the count drops).
-- verify-loader-platforms-skip-scan.ts requires the LATEST definition of loader_active_platforms_ar() to prove,
-- in its own transaction, that the skip scan returns exactly what a full scan returns. Same body as
-- 20261027201642; the full-scan oracle carries the same two conditions (active in platform_registry, and a
-- production_ready row).
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

do $chk$
begin
  if public.loader_active_platforms_ar() is distinct from
     (select coalesce(array_agg(distinct s.platform order by s.platform), '{}'::text[])
        from public.search_listings_ar s
        join public.platform_registry r on r.platform = s.platform and r.status = 'active'
       where s.platform is not null and s.platform <> '' and s.production_ready) then
    raise exception 'loader_active_platforms_ar: the skip scan disagrees with the full scan — rolling back';
  end if;
end
$chk$;
