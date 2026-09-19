-- عقاريون joins platform_registry and the liveness registry — launch-checklist boxes 2 and 5.
-- Landing together with scrapers/common/liveness_policies.py and sql/mirrors/liveness_registry.json
-- in ONE change: the drift gate is GLOBAL and fail-closed, so a migration applied without its two
-- mirrors blocks EVERY deploy in the repo for every session until they catch up (the 2026-09-06
-- incident that paused a 40-platform audit to open a deploy window).
--
-- LIVENESS: CRAWL_PRESENCE_ONLY. Control-validated live 2026-09-18 against this platform's real
-- retirement behaviour — it hard-404s a url it no longer serves:
--   · fyla-llbyaa-fy-hy-alghnamy-6 (live) -> HTTP 200, page renders «رقم الاعلان»
--   · ard-llbyaa-fy-hy-bdr         (live) -> HTTP 200, page renders «رقم الاعلان»
--   · this-slug-never-existed-zzz99       -> HTTP 404
-- Unlike the WordPress siblings there is no REST api to attribute a 404 to, so the ad-number check
-- on a 200 is what stops a shell or a routing change from reading as alive. Absence from the crawl
-- only SELECTS candidates; scrapers/akariyoun/run.py::_verify_gone gives each at-grace row a DIRECT
-- confirm before prune_unseen may deactivate it, and 'unknown' holds the strike without killing.
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace)
values ('akariyoun','CRAWL_PRESENCE_ONLY',168,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;

insert into public.platform_registry (platform, status, expected_cadence_hours, window_days, notes, kind, updated_at)
values ('akariyoun', 'active', 24, 7, null, 'source', now())
on conflict (platform) do nothing;

do $verify$
declare v_status text; v_strategy text; v_unmonitored int;
begin
  select strategy into strict v_strategy from public.ops_liveness_registry where platform='akariyoun';
  if v_strategy <> 'CRAWL_PRESENCE_ONLY' then
    raise exception 'akariyoun landed on the wrong liveness strategy: %', v_strategy;
  end if;
  select status into strict v_status from public.platform_registry where platform = 'akariyoun';
  if v_status <> 'active' then
    raise exception 'akariyoun registry row landed with status %', v_status;
  end if;
  -- and it must not itself be reported as an unmonitored searchable platform (the muktamel-shaped
  -- blind spot: searchable, scraped, and watched by nothing)
  select count(*) into v_unmonitored
    from public.ops_searchable_platforms_unmonitored() u
   where u::text ilike '%akariyoun%';
  if v_unmonitored > 0 then
    raise exception 'akariyoun is still reported as an unmonitored searchable platform';
  end if;
end $verify$;