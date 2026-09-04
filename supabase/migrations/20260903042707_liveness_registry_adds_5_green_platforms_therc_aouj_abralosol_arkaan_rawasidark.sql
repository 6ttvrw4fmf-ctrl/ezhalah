-- Register the 5 new GREEN platforms in ops_liveness_registry so MONITORING knows about them.
--
-- The registry is declared in THREE places that must agree, and scripts/verify-liveness-registry-
-- mirror.ts fails CI if they drift: scrapers/common/liveness_policies.py (what the crawler
-- believes), sql/mirrors/liveness_registry.json (the pivot), and this table (what the dashboard and
-- both liveness detectors read from inside Postgres). The canonical seed statement lives in
-- 20260830191646_liveness_coverage_dashboard_and_monitors.sql and is deliberately idempotent
-- (on-conflict upsert + a delete of anything no longer in the registry); this migration re-applies
-- exactly that statement with the 5 additions, so production matches the updated declaration.
--
-- TIER, chosen honestly: CRAWL_PRESENCE_ONLY. All five scrapers re-read their FULL catalogue every
-- run and prune what is absent, but none performs an affirmative per-listing revisit, so absence is
-- a strong hint rather than proof of death. Recording the weaker tier is the point of the registry:
-- these rows are reported as UNVERIFIED by the staleness monitor instead of being silently counted
-- as verified-alive. Deactivation itself still goes through liveness_contract.decide(), whose
-- 0-seen circuit breaker means a failed/empty crawl can never mass-deactivate a platform.
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
on conflict (platform) do update
  set strategy = excluded.strategy,
      sla_hours = excluded.sla_hours,
      grace = excluded.grace;

delete from public.ops_liveness_registry
where platform not in ('abeea','abralosol','aldarim','alhoshan','alkhaas','aouj','aqar','aqaratikom','aqarcity','aqargate','aqarmonthly','arkaan','dealapp','eaqartabuk','eastabha','erapulse','fursaghyr','gathern','hajer','jazwtn','jurash','mizlaj','mustqr','nowaisiry','october','raghdan','ramzalqasim','rawasidark','sadin','sanadak','satel','souq24','therc','wasalt');

select platform, strategy, sla_hours, grace
from public.ops_liveness_registry
where platform in ('therc','aouj','abralosol','arkaan','rawasidark')
order by platform;
