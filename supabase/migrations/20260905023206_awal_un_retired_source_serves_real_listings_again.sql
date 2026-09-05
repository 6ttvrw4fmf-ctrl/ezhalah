-- awal RETURNS TO SEARCH — the retirement's own precondition is now satisfied (owner 2026-09-04).
--
-- WHAT WAS TRUE. awal was retired 2026-07-28: awaalun.com had lapsed to a GoDaddy parking page,
-- serving 114-133 byte redirect stubs for both /wp-json/wp/v2/rtcl_listing and the individual
-- /property/ URLs. small-sources-sync.yml recorded the condition for its return in writing:
-- "Do not re-add without confirming the domain serves real listings again."
--
-- WHAT IS TRUE NOW, MEASURED 2026-09-04 (not assumed — probed live before this migration):
--   · /wp-json/wp/v2/rtcl_listing → HTTP 200, header x-wp-total: 128. The parking stub is gone.
--   · The SHIPPED scraper (scrapers/awal/run.py, unchanged) parses all 128 posts into rows with
--     128 DISTINCT ad_numbers, 128 distinct listing_urls and 128 distinct descriptions. This was
--     checked explicitly because the sibling revival candidate FAILED exactly here: toor's parser
--     maps six different detail pages onto ONE identical listing with a null id and null price, so
--     reviving it would manufacture 82 duplicates. toor therefore stays retired.
--
-- TWO SOURCE FACTS, recorded so neither is later mistaken for a defect:
--   · LOW CHURN. The newest listing is dated 2026-02-14. A run that returns the same 128 rows is
--     the source being quiet, NOT a broken crawl. The CRAWL_PRESENCE_ONLY/168h policy below is the
--     honest tier for that: absence is a hint, never proof, and nothing here deactivates a row.
--   · NO PRICE. The source publishes none — 0/128 carry a price in the REST payload AND on the
--     detail pages. That is a SOURCE fact, not a parse gap, and it is left as NULL. Nothing is
--     inferred, derived or filled (PRICE = SOURCE). 7,534 rows already live (3.83% of the index)
--     are priceless for the same reason, so this is the established, honest shape.
--
-- Both tables are ALREADY union arms of active_listing_ids_v2, so no view rebuild is needed; the
-- rows reach search_listings_ar as soon as a run marks them active. This migration only flips the
-- registry status the searchable-inventory generator reads, and registers the liveness policy that
-- every production-searchable platform must have.

update public.platform_registry
   set status = 'active',
       notes  = 'un-retired 2026-09-04 (owner-instructed): awaalun.com serves real listings again — '
                || 'x-wp-total 128, 128 distinct ad_numbers parsed. Low-churn (newest 2026-02-14) and '
                || 'the source publishes NO price (0/128, left NULL — never inferred).'
 where platform = 'awal';

-- Re-seed the WHOLE registry from sql/mirrors/liveness_registry.json (36 platforms), because
-- verify-liveness-registry-mirror.ts holds the LATEST seed migration to exact equality with the
-- JSON mirror, and the retention delete must match it too.
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace) values
  ('abeea','CRAWL_PRESENCE_ONLY',168,3),
  ('abralosol','CRAWL_PRESENCE_ONLY',168,3),
  ('aldarim','CRAWL_PRESENCE_ONLY',168,3),
  ('alhoshan','CRAWL_PRESENCE_ONLY',168,3),
  ('alkhaas','CRAWL_PRESENCE_ONLY',168,3),
  ('aouj','CRAWL_PRESENCE_ONLY',168,3),
  ('aqar','DIRECT_REVISIT',48,3),
  ('aqaratikom','CRAWL_PRESENCE_ONLY',168,3),
  ('aqarcity','CRAWL_PRESENCE_ONLY',168,3),
  ('aqargate','CRAWL_PRESENCE_ONLY',168,3),
  ('aqarmonthly','CRAWL_PRESENCE_ONLY',168,3),
  ('arkaan','CRAWL_PRESENCE_ONLY',168,3),
  ('awal','CRAWL_PRESENCE_ONLY',168,3),
  ('dealapp','CANDIDATE_PLUS_DIRECT',96,3),
  ('eaqartabuk','CRAWL_PRESENCE_ONLY',168,3),
  ('eastabha','CRAWL_PRESENCE_ONLY',168,3),
  ('erapulse','CRAWL_PRESENCE_ONLY',168,3),
  ('fursaghyr','CRAWL_PRESENCE_ONLY',168,3),
  ('gathern','DIRECT_REVISIT',96,3),
  ('hajer','CRAWL_PRESENCE_ONLY',168,3),
  ('jazwtn','CRAWL_PRESENCE_ONLY',168,3),
  ('jurash','CRAWL_PRESENCE_ONLY',168,3),
  ('mizlaj','CRAWL_PRESENCE_ONLY',168,3),
  ('muktamel','CRAWL_PRESENCE_ONLY',168,3),
  ('mustqr','CRAWL_PRESENCE_ONLY',168,3),
  ('nowaisiry','CRAWL_PRESENCE_ONLY',168,3),
  ('october','CRAWL_PRESENCE_ONLY',168,3),
  ('raghdan','CRAWL_PRESENCE_ONLY',168,3),
  ('ramzalqasim','CRAWL_PRESENCE_ONLY',168,3),
  ('rawasidark','CRAWL_PRESENCE_ONLY',168,3),
  ('sadin','CRAWL_PRESENCE_ONLY',168,3),
  ('sanadak','CRAWL_PRESENCE_ONLY',168,3),
  ('satel','CRAWL_PRESENCE_ONLY',168,3),
  ('souq24','CRAWL_PRESENCE_ONLY',168,3),
  ('therc','CRAWL_PRESENCE_ONLY',168,3),
  ('wasalt','DIRECT_REVISIT',96,3)
on conflict (platform) do update set strategy = excluded.strategy,
  sla_hours = excluded.sla_hours, grace = excluded.grace;

delete from public.ops_liveness_registry
where platform not in ('abeea','abralosol','aldarim','alhoshan','alkhaas','aouj','aqar','aqaratikom','aqarcity','aqargate','aqarmonthly','arkaan','awal','dealapp','eaqartabuk','eastabha','erapulse','fursaghyr','gathern','hajer','jazwtn','jurash','mizlaj','muktamel','mustqr','nowaisiry','october','raghdan','ramzalqasim','rawasidark','sadin','sanadak','satel','souq24','therc','wasalt');

-- Fail closed: every platform contributing searchable listings must be registered.
do $$
declare v_gap text[];
begin
  select coalesce(array_agg(distinct split_part(s.source_table,'_',1)), '{}') into v_gap
    from public.search_listings_ar s
   where s.production_ready
     and not exists (select 1 from public.ops_liveness_registry r
                      where r.platform = split_part(s.source_table,'_',1));
  if cardinality(v_gap) > 0 then
    raise exception 'platforms searchable but unregistered after this seed: %', v_gap;
  end if;
end $$;