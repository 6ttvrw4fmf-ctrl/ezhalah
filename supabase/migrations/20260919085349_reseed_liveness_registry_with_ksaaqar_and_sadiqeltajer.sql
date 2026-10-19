-- KSA Aqar + صادق التاجر join the liveness registry — a FULL RESEED (verify-liveness-registry-
-- mirror.ts requires the LATEST registry-seed migration to be the complete registry plus a delete
-- clause; an insert-only seed cannot retire a platform, so the dashboard would keep reporting
-- coverage for inventory nothing verifies any more).
--
-- BOTH ARE CRAWL_PRESENCE_ONLY, BUT THEY DO NOT SHARE A DEATH SIGNAL. Control-validated live
-- 2026-09-19, each against a real url and a never-existing one:
--   ksaaqar       /ad/this-slug-never-existed-zzz99/   -> HTTP 404, clean
--                 a real ad                            -> HTTP 200, 191,125 bytes, spec labels
--     => a 404 IS the death signal. A 200 without the spec labels is a shell -> UNKNOWN.
--   sadiqeltajer  /ads/this-slug-never-existed-zzz99   -> HTTP **200**, 3,892 bytes, NO code
--                 a real ad                            -> HTTP 200, 233,232 bytes, «كود الاعلان»
--     => this source does NOT 404 a removed ad. A policy keyed on 404 — the obvious one, and the
--        one its sibling correctly uses — would retire NOTHING here and sold listings would stay
--        searchable forever. The signal is «كود الاعلان» on a 200: present = LIVE, absent = GONE;
--        a 404 there is UNKNOWN, not death.
-- Absence from the crawl only SELECTS candidates in both cases; the direct confirm decides, and
-- 'unknown' holds the strike without deactivating.
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
  ('arkaan','CRAWL_PRESENCE_ONLY',168,3),
  ('awal','CRAWL_PRESENCE_ONLY',168,3),
  ('azdad','CRAWL_PRESENCE_ONLY',168,3),
  ('bahadhabab','CRAWL_PRESENCE_ONLY',168,3),
  ('dealapp','CANDIDATE_PLUS_DIRECT',96,3),
  ('eaqartabuk','CRAWL_PRESENCE_ONLY',168,3),
  ('eastabha','CRAWL_PRESENCE_ONLY',168,3),
  ('erapulse','CRAWL_PRESENCE_ONLY',168,3),
  ('fursaghyr','CRAWL_PRESENCE_ONLY',168,3),
  ('gathern','DIRECT_REVISIT',96,3),
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
  ('sanadak','CRAWL_PRESENCE_ONLY',168,3),
  ('satel','CRAWL_PRESENCE_ONLY',168,3),
  ('shmoualshmal','CRAWL_PRESENCE_ONLY',168,3),
  ('souq24','CRAWL_PRESENCE_ONLY',168,3),
  ('suwar','CRAWL_PRESENCE_ONLY',168,3),
  ('therc','CRAWL_PRESENCE_ONLY',168,3),
  ('wasalt','DIRECT_REVISIT',96,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;

delete from public.ops_liveness_registry
where platform not in ('abeea','abralosol','abwbna','akariyoun','aldarim','alhoshan','alkhaas','alobid','alta','amaall','amlakalahsa','aouj','aqar','aqaralsaudia','aqaratikom','aqarcity','aqargate','aqarmonthly','arkaan','awal','azdad','bahadhabab','dealapp','eaqartabuk','eastabha','erapulse','fursaghyr','gathern','hajer','jazwtn','jurash','ksaaqar','mizlaj','muktamel','mustqr','nowaisiry','october','raghdan','rakez','ramzalqasim','rawasidark','remal','sadin','sadiqeltajer','sanadak','satel','shmoualshmal','souq24','suwar','therc','wasalt');
