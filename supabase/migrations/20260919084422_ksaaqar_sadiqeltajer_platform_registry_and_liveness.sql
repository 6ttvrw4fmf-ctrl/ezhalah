-- KSA Aqar + صادق التاجر join platform_registry and the liveness registry — boxes 2 and 5.
-- Landing together with scrapers/common/liveness_policies.py and sql/mirrors/liveness_registry.json
-- in ONE change: the drift gate is GLOBAL and fail-closed, so a migration applied without its two
-- mirrors blocks EVERY deploy in the repo for every session until they catch up.
--
-- THE TWO PLATFORMS DO NOT SHARE A DEATH SIGNAL, and that was measured rather than assumed.
-- Control-validated live 2026-09-19, each against a real url and a never-existing one:
--
--   ksaaqar      real ad                       -> HTTP 200, 191,125 bytes, spec labels present
--                /ad/this-slug-never-existed…  -> HTTP 404, clean
--     => a 404 IS the death signal here. A 200 without the spec labels is a shell -> UNKNOWN.
--
--   sadiqeltajer real ad                       -> HTTP 200, 233,232 bytes, «كود الاعلان» present
--                /ads/this-slug-never-existed… -> HTTP **200**, 3,892 bytes, NO «كود الاعلان»
--     => a 404 is NOT the death signal here; this source answers 200 for an ad it no longer has.
--        A policy keyed on 404 would never retire anything and sold listings would stay up
--        forever. The signal is «كود الاعلان» on a 200: present = LIVE, absent = GONE. A 404,
--        any 401/403/408/429/5xx, a transport failure and an unlookupable row are all UNKNOWN and
--        hold the strike without deactivating.
--
-- Absence from the crawl only SELECTS candidates in both cases; the direct confirm decides.
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace)
values ('ksaaqar','CRAWL_PRESENCE_ONLY',168,3),
       ('sadiqeltajer','CRAWL_PRESENCE_ONLY',168,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;

insert into public.platform_registry (platform, status, expected_cadence_hours, window_days, notes, kind, updated_at)
values ('ksaaqar', 'active', 24, 7, null, 'source', now()),
       ('sadiqeltajer', 'active', 24, 7, null, 'source', now())
on conflict (platform) do nothing;

do $verify$
declare v_strategy text; p text;
begin
  foreach p in array array['ksaaqar','sadiqeltajer'] loop
    select strategy into strict v_strategy from public.ops_liveness_registry where platform = p;
    if v_strategy <> 'CRAWL_PRESENCE_ONLY' then
      raise exception '% landed on the wrong liveness strategy: %', p, v_strategy;
    end if;
    if not exists (select 1 from public.platform_registry where platform = p and status = 'active') then
      raise exception '% is not active in platform_registry', p;
    end if;
  end loop;
  raise notice 'ksaaqar + sadiqeltajer registered: liveness CRAWL_PRESENCE_ONLY, platform active';
end $verify$;
