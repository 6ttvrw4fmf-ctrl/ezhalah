-- The loading strip's down-site filter (owner rule 2026-09-26): a website that is down on its side
-- loses its listings AND its logo, and the «نراجع N منصة عقارية» count drops with it; both come back
-- by themselves when the engineer flips the site back to 'active'.
--
-- platform_registry is not anon-readable, so the app cannot read a site's status itself. This returns
-- the slug and status of every WEBSITE (kind = 'source'; internal jobs such as dealapp_liveness are
-- not websites) and nothing else: no notes, no cadence. The app reads it ONCE per session
-- (src/data/loaderActivePlatforms.ts). Which statuses hide a logo, and which logo a slug belongs to,
-- are decided in src/data/loaderPlatforms.ts (hiddenLoaderNames), because several slugs share one
-- logo: 'deal' (retired) and 'dealapp' (active) are both Deal App, 'aqarmonthly' is Aqar. A logo
-- hides only when EVERY slug behind it is down, so the active rows are returned too.
--
-- Cost: one scan of a ~160-row table. It never touches search_listings_ar, unlike the ~140 ms
-- loader_strip_platforms_ar, which the per-search strip therefore does not call.

create or replace function public.loader_platform_status_ar()
returns table (platform text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select r.platform, r.status
    from public.platform_registry r
   where r.kind = 'source'
   order by r.platform;
$$;

grant execute on function public.loader_platform_status_ar() to anon, authenticated;

-- Executed against production at apply time.
do $verify$
declare
  v_fn_down  text[];
  v_reg_down text[];
  v_fn_all   text[];
  v_reg_all  text[];
begin
  -- 1. The down set the app will see is exactly the registry's down set.
  select coalesce(array_agg(f.platform order by f.platform), '{}') into v_fn_down
    from public.loader_platform_status_ar() f where f.status in ('dormant', 'retired');
  select coalesce(array_agg(r.platform order by r.platform), '{}') into v_reg_down
    from public.platform_registry r where r.kind = 'source' and r.status in ('dormant', 'retired');
  if v_fn_down is distinct from v_reg_down then
    raise exception 'down set differs from the registry: got %, registry %', v_fn_down, v_reg_down;
  end if;
  if cardinality(v_fn_down) = 0 then
    raise exception 'no down websites returned, but the registry has dormant rows today';
  end if;
  -- 2. Nothing active is reported as down, and nothing is invented or dropped: every row, with its
  --    status, is the registry's own.
  select coalesce(array_agg(f.platform || '=' || f.status order by f.platform), '{}') into v_fn_all
    from public.loader_platform_status_ar() f;
  select coalesce(array_agg(r.platform || '=' || r.status order by r.platform), '{}') into v_reg_all
    from public.platform_registry r where r.kind = 'source';
  if v_fn_all is distinct from v_reg_all then
    raise exception 'rows differ from the registry';
  end if;
  -- 3. Internal jobs are not websites.
  if exists (select 1 from public.loader_platform_status_ar() f
              join public.platform_registry r using (platform) where r.kind <> 'source') then
    raise exception 'an internal job leaked into the website list';
  end if;
  -- 4. The anon key real browsers use can call it.
  if not has_function_privilege('anon', 'public.loader_platform_status_ar()', 'execute') then
    raise exception 'anon cannot execute loader_platform_status_ar';
  end if;
  raise notice 'loader_platform_status_ar: % websites, down on their side: %', cardinality(v_fn_all), v_fn_down;
end $verify$;
