-- The eleven new platforms join platform_registry and the liveness registry.
-- Lands together with scrapers/common/liveness_policies.py and sql/mirrors/liveness_registry.json:
-- the drift gate is GLOBAL and fail-closed, so a migration applied without its two mirrors blocks
-- EVERY deploy in the repo, for every session, until they catch up. The full-registry reseed
-- verify-liveness-registry-mirror.ts reads is 20260921180600, applied right after this one.
--
-- No CREATE OR REPLACE here: two INSERTs into existing tables. Both tables were introspected live
-- before writing (2026-09-21): ops_liveness_registry held exactly the 58 rows of the committed JSON
-- mirror, platform_registry held none of the eleven, and neither table carries a trigger.
--
-- EVERY ONE OF THE ELEVEN PRUNES ONLY THROUGH A MEASURED ORACLE. Death signals were measured live
-- on 2026-09-21, each against that platform's own dead cohort (ids inside the live range that its
-- catalogue no longer carries) with interleaved known-live controls, through the real
-- _verify_gone and the shared law in scrapers/common/http_liveness.py:
--
--   bossbih / alshawaf / aljassim   Drupal nodes; the office DELETES a node → HTTP 404 (30/30,
--                                   31/31, 31/31 of the dead cohort; 15/15 live controls each).
--   alsidra / masar                 wp/v2 REST record → 404 rest_post_invalid_id; a non-publish
--                                   status, an «مزاد» status or a closed-deal phrase → GONE
--                                   (alsidra: 26/26 sellable LIVE, 20/20 auctions GONE).
--   moftah                          Woo Store API → 404 woocommerce_rest_product_invalid_id.
--   gomenassat   *** NOT A 404 ***  a deleted offer answers 200 «نأسف! هذه الصفحة غير متوفرة»
--                                   (21/21); a transacted offer keeps its page with a «تم البيع»
--                                   badge (8/8). Canary-gated.
--   sakan        *** NOT A 404 ***  a removed listing 301s to /ar/properties/buy. And the sitemap
--                                   is NOT the catalogue: 3 of 40 gap ids were live «فعال»
--                                   listings pdpmap.xml omits — absence alone would retire them.
--                                   Canary-gated.
--   ialqarawi    *** NOT A 404 ***  an unknown id answers 200 with the HOMEPAGE (111/120), and a
--                                   listing taken out of every category keeps its page with an
--                                   empty «القسم» (9/120). Canary-gated.
--   almotmkenah                     the site's own archive banner, read by the run's own crawl; an
--                                   ad the run never reached is probed at its own URL (404 = gone).
--   nufouth                         DATA: the ad/unit gone from the property's API record, or the
--                                   property left with zero ads. A 403 is Frappe's "no such
--                                   property" but stays UNKNOWN under the law; a deleted property
--                                   is retired by /B/<code> «العقار المطلوب غير موجود», gated on
--                                   that same API 403.
--
-- All eleven stay CRAWL_PRESENCE_ONLY/168h/3: an at-grace oracle does not verify the POPULATION,
-- so a higher tier would be a claim nothing measures (the aqargate note in liveness_policies.py).
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace)
values ('alsidra','CRAWL_PRESENCE_ONLY',168,3),
       ('moftah','CRAWL_PRESENCE_ONLY',168,3),
       ('masar','CRAWL_PRESENCE_ONLY',168,3),
       ('gomenassat','CRAWL_PRESENCE_ONLY',168,3),
       ('sakan','CRAWL_PRESENCE_ONLY',168,3),
       ('bossbih','CRAWL_PRESENCE_ONLY',168,3),
       ('alshawaf','CRAWL_PRESENCE_ONLY',168,3),
       ('ialqarawi','CRAWL_PRESENCE_ONLY',168,3),
       ('aljassim','CRAWL_PRESENCE_ONLY',168,3),
       ('almotmkenah','CRAWL_PRESENCE_ONLY',168,3),
       ('nufouth','CRAWL_PRESENCE_ONLY',168,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;

-- expected_cadence_hours 24: every one of the eleven is scheduled DAILY in small-sources-sync.yml
-- (sakan's ~3,160 detail pages included — its 180-minute job fits inside a day with room to spare).
-- The owner's standing note for small offices applies: the freshness bar is the cadence, not a
-- volume expectation.
insert into public.platform_registry (platform, status, expected_cadence_hours, window_days, notes, kind, updated_at)
values ('alsidra','active',24,7,'مكتب السدرة العقارية. WordPress + Houzez via the ?rest_route= form only (/wp-json 404s here). ~46 posts, ~20 of them «مزاد» auctions that are skipped, never published.','source',now()),
       ('moftah','active',24,7,'مفتاح العقار. WooCommerce Store API. Its CDN challenges chrome* TLS fingerprints with a 6,192-byte 403 — session() negotiates a served profile (safari/firefox); a 403 here is the fingerprint, not a dead site.','source',now()),
       ('masar','active',24,7,'مسار المستقبل. wp/v2 behind Hostinger''s hcdn JS challenge, whose interstitial is served with HTTP 200 — solved per session with stdlib SHA-256. ~9 listings; only one publishes a price at all.','source',now()),
       ('gomenassat','active',24,7,'شركة منصات العقارية. Catalogue = POST /ar/get_offers (the 2023 sitemap lists 6 of 256). ~100 offers are «تم البيع/تم الإيجار» and skipped. A deleted offer answers HTTP 200 with a soft-404 sentence, not a 404.','source',now()),
       ('sakan','active',24,7,'Sakan Saudi. ~3,160 JSON-LD detail pages from pdpmap.xml — the largest of the batch (180-min job). The sitemap is NOT the whole catalogue, and a removed listing 301s to the listings index instead of 404ing.','source',now()),
       ('bossbih','active',24,7,'مكتب بوصبيح العقاري, Al-Ahsa. Drupal 8, ~1,485 nodes walked page by page; 364 are priced PER SQUARE METRE by label. No listing states a city — the governorate «الاحساء» is the honest broad fallback. Deleted nodes 404.','source',now()),
       ('alshawaf','active',24,7,'مكتب الشواف العقاري, Al-Ahsa. Drupal 10 /table view, ~987 nodes; 21% priced per square metre by label; no rent period is ever stated. Deleted nodes 404.','source',now()),
       ('ialqarawi','active',24,7,'مكتب إبراهيم القرعاوي. Custom PHP, 66 whole-category pages, ~2,641 listings. An unknown id answers HTTP 200 with the HOMEPAGE, and a delisted ad keeps its page with an empty «القسم» — neither is a 404.','source',now()),
       ('aljassim','active',24,7,'مكتب الجاسم, Al-Ahsa. Drupal behind an hcdn SHA-256 JS challenge (a 403 interstitial) that the scraper solves; ~90 listings. Deleted nodes 404.','source',now()),
       ('almotmkenah','active',24,7,'Almotmkenah. 361 ads in the index but ~22 live: the site archives the rest itself («تم نقله للأرشيف»), so rows_seen, not rows_upserted, is its health signal.','source',now()),
       ('nufouth','active',24,7,'نفوذ. Frappe app; the whole record comes from the guest API get_property_data (Accept-Language: ar is mandatory). Row grain is the UNIT. A 403 from that API is Frappe''s "no such property", not a block.','source',now())
on conflict (platform) do nothing;

do $verify$
declare v_strategy text; p text; n int;
begin
  foreach p in array array['alsidra','moftah','masar','gomenassat','sakan','bossbih','alshawaf',
                           'ialqarawi','aljassim','almotmkenah','nufouth'] loop
    select strategy into strict v_strategy from public.ops_liveness_registry where platform = p;
    if v_strategy <> 'CRAWL_PRESENCE_ONLY' then
      raise exception '% landed on the wrong liveness strategy: %', p, v_strategy;
    end if;
    if not exists (select 1 from public.platform_registry where platform = p and status = 'active') then
      raise exception '% is not active in platform_registry', p;
    end if;
  end loop;
  select count(*) into n from public.platform_registry where status = 'active';
  raise notice 'eleven platforms registered; platform_registry now has % active', n;
end $verify$;
