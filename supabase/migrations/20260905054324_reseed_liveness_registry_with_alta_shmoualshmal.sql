-- Re-seed the WHOLE liveness registry from sql/mirrors/liveness_registry.json (38 platforms),
-- now including alta and shmoualshmal.
--
-- WHY THE WHOLE THING AND NOT JUST THE TWO NEW ROWS: verify-liveness-registry-mirror.ts holds the
-- LATEST seed migration to EXACT equality with the JSON mirror, and separately requires a retention
-- delete. An insert-only two-row seed fails both checks — and the second one matters in production,
-- not just in CI: without the delete, a platform that LEAVES the registry keeps being reported as
-- covered, so the dashboard claims verification for inventory nothing grades any more.
--
-- alta and shmoualshmal are registered at CRAWL_PRESENCE_ONLY/168h/grace 3 — the honest tier for a
-- small WordPress REST catalogue re-read in full each run with no per-listing revisit endpoint.
-- alta additionally publishes an explicit property_status (تم البيع / تم التأجير / غير متاح) which
-- its scraper reads directly; that is SOURCE-STATED removal and deactivates through the scraper,
-- never through this monitoring tier.
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace) values
  ('abeea','CRAWL_PRESENCE_ONLY',168,3),
  ('abralosol','CRAWL_PRESENCE_ONLY',168,3),
  ('aldarim','CRAWL_PRESENCE_ONLY',168,3),
  ('alhoshan','CRAWL_PRESENCE_ONLY',168,3),
  ('alkhaas','CRAWL_PRESENCE_ONLY',168,3),
  ('alta','CRAWL_PRESENCE_ONLY',168,3),
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
  ('shmoualshmal','CRAWL_PRESENCE_ONLY',168,3),
  ('souq24','CRAWL_PRESENCE_ONLY',168,3),
  ('therc','CRAWL_PRESENCE_ONLY',168,3),
  ('wasalt','DIRECT_REVISIT',96,3)
on conflict (platform) do update set strategy = excluded.strategy,
  sla_hours = excluded.sla_hours, grace = excluded.grace;

delete from public.ops_liveness_registry
where platform not in ('abeea','abralosol','aldarim','alhoshan','alkhaas','alta','aouj','aqar','aqaratikom','aqarcity','aqargate','aqarmonthly','arkaan','awal','dealapp','eaqartabuk','eastabha','erapulse','fursaghyr','gathern','hajer','jazwtn','jurash','mizlaj','muktamel','mustqr','nowaisiry','october','raghdan','ramzalqasim','rawasidark','sadin','sanadak','satel','shmoualshmal','souq24','therc','wasalt');

-- Fail closed: no platform may contribute searchable rows without a registered liveness policy.
do $$
declare v_gap text[];
begin
  select coalesce(array_agg(distinct split_part(s.source_table,'_',1)), '{}') into v_gap
    from public.search_listings_ar s
   where s.production_ready
     and not exists (select 1 from public.ops_liveness_registry r
                      where r.platform = split_part(s.source_table,'_',1));
  if cardinality(v_gap) > 0 then
    raise exception 'searchable but unregistered: %', v_gap;
  end if;
end $$;
