-- سوار joins platform_registry — the registry scripts/gen-searchable-tables.ts and the
-- "unmonitored searchable platforms" check both read. A platform with real tables and a liveness
-- entry but NO row here is the muktamel-shaped blind spot ops_searchable_platforms_unmonitored()
-- exists to catch: searchable, scraped, and watched by nothing. amlakalahsa spent a day in exactly
-- that state (20260913035031), so this lands in the same change as the tables rather than after.
-- Values match its sibling recently-added source platforms.
insert into public.platform_registry (platform, status, expected_cadence_hours, window_days, notes, kind, updated_at)
values ('suwar', 'active', 24, 7, null, 'source', now())
on conflict (platform) do nothing;

do $verify$
declare v_status text; v_unmonitored int;
begin
  select status into strict v_status from public.platform_registry where platform = 'suwar';
  if v_status <> 'active' then
    raise exception 'suwar registry row landed with status %', v_status;
  end if;
  -- and it must not itself be reported as an unmonitored searchable platform
  select count(*) into v_unmonitored
    from public.ops_searchable_platforms_unmonitored() u
   where u::text ilike '%suwar%';
  if v_unmonitored > 0 then
    raise exception 'suwar is still reported as an unmonitored searchable platform';
  end if;
end $verify$;