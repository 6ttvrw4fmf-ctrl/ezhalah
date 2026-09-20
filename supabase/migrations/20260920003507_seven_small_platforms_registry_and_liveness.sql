-- The seven new platforms join platform_registry and the liveness registry.
-- Lands together with scrapers/common/liveness_policies.py and sql/mirrors/liveness_registry.json:
-- the drift gate is GLOBAL and fail-closed, so a migration applied without its two mirrors blocks
-- EVERY deploy in the repo, for every session, until they catch up.
--
-- DEATH SIGNALS WERE MEASURED PER PLATFORM, not assumed. Probed live 2026-09-19, each against a
-- real listing URL and one that never existed:
--
--   gudai / safera / alhumaidan  WordPress /property/ posts. A deleted post hard-404s. A 200
--                                without the «تفاصيل العقار»/«نظرة عامة» block is a shell → UNKNOWN.
--   aqarnajran                   wp/v2 posts; a missing post 404s (measured: /this-never-existed
--                                → 404). Absence from the API listing selects candidates.
--   fahadalshahri                WooCommerce; /product/this-never-existed → 404. NOTE the
--                                transport asymmetry: the Store API answers a BARE session and
--                                403s an impersonated TLS fingerprint, so a 403 here is the
--                                fingerprint, never death.
--   compoundin                   *** DOES NOT 404 ***. A delisted compound answers HTTP 200 with
--                                «This compound is no longer listed» and a strip of OTHER
--                                compounds. 62 of its 129 compounds are in that state right now.
--                                A policy keyed on 404 would retire nothing here, ever. The signal
--                                is that sentence on a 200.
--   wslnaa                       client-rendered; the tRPC record carries status/active/deletedAt
--                                explicitly, so death is a FIELD, not an HTTP code.
--
-- All seven therefore use CRAWL_PRESENCE_ONLY: absence from the crawl only SELECTS candidates and
-- the per-platform confirm decides, which is the only strategy that is correct for a source whose
-- dead pages return 200.
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace)
values ('gudai','CRAWL_PRESENCE_ONLY',168,3),
       ('safera','CRAWL_PRESENCE_ONLY',168,3),
       ('alhumaidan','CRAWL_PRESENCE_ONLY',168,3),
       ('aqarnajran','CRAWL_PRESENCE_ONLY',168,3),
       ('fahadalshahri','CRAWL_PRESENCE_ONLY',168,3),
       ('compoundin','CRAWL_PRESENCE_ONLY',168,3),
       ('wslnaa','CRAWL_PRESENCE_ONLY',168,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;

-- expected_cadence_hours 24: all seven are small offices that post rarely. The owner's standing
-- note applies — «those websites are very small, so we will not get on a daily basis» — so the
-- freshness bar is the cadence, not a volume expectation.
insert into public.platform_registry (platform, status, expected_cadence_hours, window_days, notes, kind, updated_at)
values ('gudai','active',24,7,'inblaj.net tenant office; shares scrapers/common/inblaj_platform.py with safera and alhumaidan. Small catalogue (12).','source',now()),
       ('safera','active',24,7,'inblaj.net tenant office (theme variant B: no colons, similar-ads tail). Small catalogue (9).','source',now()),
       ('alhumaidan','active',24,7,'inblaj.net tenant office. All 3 of its listings are «تم الإيجار» as of onboarding, so it contributes 0 active rows today — that is the honest state of its inventory, not a scraper fault. The scraper picks up a new listing the day it posts one.','source',now()),
       ('aqarnajran','active',24,7,'wp/v2 REST. Publishes NO photos at all (bodies are HTML tables, featured_media 0) — zero photos is this source''s honest state.','source',now()),
       ('fahadalshahri','active',24,7,'WooCommerce Store API, and it 403s an impersonated TLS fingerprint — use a bare session. Only ~5 of 25 products name a city; the rest are skipped rather than assumed to be Jeddah.','source',now()),
       ('compoundin','active',24,7,'Residential compounds, ENGLISH source. Row grain is the UNIT, not the compound. Delisted compounds answer HTTP 200 with «This compound is no longer listed» — death is not a 404 here.','source',now()),
       ('wslnaa','active',24,7,'Client-rendered; read from the app''s own /api/trpc/properties.bySlug. The HTML carries no listing values at all. `region` holds the CITY; `rooms` is NOT bedrooms on commercial rows.','source',now())
on conflict (platform) do nothing;

do $verify$
declare v_strategy text; p text; n int;
begin
  foreach p in array array['gudai','safera','alhumaidan','aqarnajran','fahadalshahri','compoundin','wslnaa'] loop
    select strategy into strict v_strategy from public.ops_liveness_registry where platform = p;
    if v_strategy <> 'CRAWL_PRESENCE_ONLY' then
      raise exception '% landed on the wrong liveness strategy: %', p, v_strategy;
    end if;
    if not exists (select 1 from public.platform_registry where platform = p and status = 'active') then
      raise exception '% is not active in platform_registry', p;
    end if;
  end loop;
  select count(*) into n from public.platform_registry where status = 'active';
  raise notice 'seven platforms registered; platform_registry now has % active', n;
end $verify$;
