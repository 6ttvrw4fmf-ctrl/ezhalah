-- The seven small platforms join the liveness registry — a FULL RESEED.
-- verify-liveness-registry-mirror.ts requires the LATEST registry-seed migration to be the COMPLETE
-- registry plus a delete clause: an insert-only seed cannot retire a platform, so the dashboard
-- would keep reporting coverage for inventory nothing verifies any more.
--
-- THE SEVEN DO NOT SHARE A DEATH SIGNAL, and each was control-validated live 2026-09-19 against a
-- real url and one that never existed. Two are worth naming because the obvious policy is wrong:
--
--   compoundin    a delisted compound answers HTTP **200** with «This compound is no longer
--                 listed» in its <h1>, plus a strip of OTHER compounds. 62 of its 129 compounds
--                 are in that state right now, so a 404-keyed policy would retire NOTHING here.
--   fahadalshahri its Store API answers a BARE session and returns **403** to an impersonated TLS
--                 fingerprint. A 403 on this platform is the fingerprint, never death — the
--                 amlakalahsa shape.
--
-- The rest: gudai/safera/alhumaidan (WordPress /property/, hard-404 on delete, but DIFFERENT
-- detail-block markers per theme variant), aqarnajran (wp/v2 post, hard-404), and wslnaa, where
-- death is a FIELD — its tRPC record carries status/active/deletedAt explicitly.
--
-- Generated from sql/mirrors/liveness_registry.json so the SQL, the JSON mirror and
-- scrapers/common/liveness_policies.py cannot disagree.
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace) values
  ('abeea','CRAWL_PRESENCE_ONLY',168,3),
  ('abralosol','CRAWL_PRESENCE_ONLY',168,3),
  ('abwbna','CRAWL_PRESENCE_ONLY',168,3),
  ('akariyoun','CRAWL_PRESENCE_ONLY',168,3),
  ('aldarim','CRAWL_PRESENCE_ONLY',168,3),
  ('alhoshan','CRAWL_PRESENCE_ONLY',168,3),
  ('alhumaidan','CRAWL_PRESENCE_ONLY',168,3),
  ('alkhaas','CRAWL_PRESENCE_ONLY',168,3),
  ('alobid','CRAWL_PRESENCE_ONLY',168,3),
  ('alta','CRAWL_PRESENCE_ONLY',168,3),
  ('amaall','CRAWL_PRESENCE_ONLY',168,3),
  ('amlakalahsa','CRAWL_PRESENCE_ONLY',168,3),
  ('aouj','CRAWL_PRESENCE_ONLY',168,3),
  ('aqar','DIRECT_REVISIT',48,3),
  ('aqaralsaudia','CRAWL_PRESENCE_ONLY',168,3),
  ('aqaratikom','CRAWL_PRESENCE_ONLY',168,3),
  ('aqarcity','CRAWL_PRESENCE_ONLY',168,3),
  ('aqargate','CRAWL_PRESENCE_ONLY',168,3),
  ('aqarmonthly','CRAWL_PRESENCE_ONLY',168,3),
  ('aqarnajran','CRAWL_PRESENCE_ONLY',168,3),
  ('arkaan','CRAWL_PRESENCE_ONLY',168,3),
  ('awal','CRAWL_PRESENCE_ONLY',168,3),
  ('azdad','CRAWL_PRESENCE_ONLY',168,3),
  ('bahadhabab','CRAWL_PRESENCE_ONLY',168,3),
  ('compoundin','CRAWL_PRESENCE_ONLY',168,3),
  ('dealapp','CANDIDATE_PLUS_DIRECT',96,3),
  ('eaqartabuk','CRAWL_PRESENCE_ONLY',168,3),
  ('eastabha','CRAWL_PRESENCE_ONLY',168,3),
  ('erapulse','CRAWL_PRESENCE_ONLY',168,3),
  ('fahadalshahri','CRAWL_PRESENCE_ONLY',168,3),
  ('fursaghyr','CRAWL_PRESENCE_ONLY',168,3),
  ('gathern','DIRECT_REVISIT',96,3),
  ('gudai','CRAWL_PRESENCE_ONLY',168,3),
  ('hajer','CRAWL_PRESENCE_ONLY',168,3),
  ('jazwtn','CRAWL_PRESENCE_ONLY',168,3),
  ('jurash','CRAWL_PRESENCE_ONLY',168,3),
  ('ksaaqar','CRAWL_PRESENCE_ONLY',168,3),
  ('mizlaj','CRAWL_PRESENCE_ONLY',168,3),
  ('muktamel','CRAWL_PRESENCE_ONLY',168,3),
  ('mustqr','CRAWL_PRESENCE_ONLY',168,3),
  ('nowaisiry','CRAWL_PRESENCE_ONLY',168,3),
  ('october','CRAWL_PRESENCE_ONLY',168,3),
  ('raghdan','CRAWL_PRESENCE_ONLY',168,3),
  ('rakez','CRAWL_PRESENCE_ONLY',168,3),
  ('ramzalqasim','CRAWL_PRESENCE_ONLY',168,3),
  ('rawasidark','CRAWL_PRESENCE_ONLY',168,3),
  ('remal','CRAWL_PRESENCE_ONLY',168,3),
  ('sadin','CRAWL_PRESENCE_ONLY',168,3),
  ('sadiqeltajer','CRAWL_PRESENCE_ONLY',168,3),
  ('safera','CRAWL_PRESENCE_ONLY',168,3),
  ('sanadak','CRAWL_PRESENCE_ONLY',168,3),
  ('satel','CRAWL_PRESENCE_ONLY',168,3),
  ('shmoualshmal','CRAWL_PRESENCE_ONLY',168,3),
  ('souq24','CRAWL_PRESENCE_ONLY',168,3),
  ('suwar','CRAWL_PRESENCE_ONLY',168,3),
  ('therc','CRAWL_PRESENCE_ONLY',168,3),
  ('wasalt','DIRECT_REVISIT',96,3),
  ('wslnaa','CRAWL_PRESENCE_ONLY',168,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;

delete from public.ops_liveness_registry
where platform not in ('abeea','abralosol','abwbna','akariyoun','aldarim','alhoshan','alhumaidan','alkhaas','alobid','alta','amaall','amlakalahsa','aouj','aqar','aqaralsaudia','aqaratikom','aqarcity','aqargate','aqarmonthly','aqarnajran','arkaan','awal','azdad','bahadhabab','compoundin','dealapp','eaqartabuk','eastabha','erapulse','fahadalshahri','fursaghyr','gathern','gudai','hajer','jazwtn','jurash','ksaaqar','mizlaj','muktamel','mustqr','nowaisiry','october','raghdan','rakez','ramzalqasim','rawasidark','remal','sadin','sadiqeltajer','safera','sanadak','satel','shmoualshmal','souq24','suwar','therc','wasalt','wslnaa');
