-- The eleven platforms join the liveness registry — a FULL RESEED.
-- verify-liveness-registry-mirror.ts requires the LATEST registry-seed migration to be the COMPLETE
-- registry plus a delete clause: an insert-only seed cannot retire a platform, so the dashboard
-- would keep reporting coverage for inventory nothing verifies any more.
--
-- Based on the LIVE table, introspected read-only 2026-09-21: ops_liveness_registry held exactly
-- the 58 rows of the committed sql/mirrors/liveness_registry.json (same strategy/sla/grace on
-- every one), so this reseed changes NOTHING for them and adds the eleven below.
--
-- THE ELEVEN DO NOT SHARE A DEATH SIGNAL, and each was measured live against its own dead cohort
-- with interleaved live controls (the numbers are in each scraper's LIVENESS block and in
-- 20260921180400). Three are worth naming because the obvious policy is wrong for them:
--
--   sakan       a removed listing 301s to the listings index instead of 404ing, AND the sitemap
--               is not the catalogue — live «فعال» listings exist outside it, so absence alone
--               would retire live inventory.
--   ialqarawi   an unknown id answers HTTP 200 with the HOMEPAGE; a delisted ad keeps its page
--               with an empty «القسم».
--   gomenassat  a deleted offer answers HTTP 200 with a soft-404 sentence.
--
-- Those three gate every removal on an in-run positive control that fails CLOSED. The Drupal
-- trio (bossbih, alshawaf, aljassim) hard-404 a deleted node; alsidra/masar/moftah answer their
-- REST record's own invalid-id 404; almotmkenah reads its own archive banner (or its own URL's 404);
-- nufouth's death is data in its API record (or its own /B/ page, API-gated). None of the eleven
-- deactivates on absence alone.
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
  ('aljassim','CRAWL_PRESENCE_ONLY',168,3),
  ('alkhaas','CRAWL_PRESENCE_ONLY',168,3),
  ('almotmkenah','CRAWL_PRESENCE_ONLY',168,3),
  ('alobid','CRAWL_PRESENCE_ONLY',168,3),
  ('alshawaf','CRAWL_PRESENCE_ONLY',168,3),
  ('alsidra','CRAWL_PRESENCE_ONLY',168,3),
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
  ('bossbih','CRAWL_PRESENCE_ONLY',168,3),
  ('compoundin','CRAWL_PRESENCE_ONLY',168,3),
  ('dealapp','CANDIDATE_PLUS_DIRECT',96,3),
  ('eaqartabuk','CRAWL_PRESENCE_ONLY',168,3),
  ('eastabha','CRAWL_PRESENCE_ONLY',168,3),
  ('erapulse','CRAWL_PRESENCE_ONLY',168,3),
  ('fahadalshahri','CRAWL_PRESENCE_ONLY',168,3),
  ('fursaghyr','CRAWL_PRESENCE_ONLY',168,3),
  ('gathern','DIRECT_REVISIT',96,3),
  ('gomenassat','CRAWL_PRESENCE_ONLY',168,3),
  ('gudai','CRAWL_PRESENCE_ONLY',168,3),
  ('hajer','CRAWL_PRESENCE_ONLY',168,3),
  ('ialqarawi','CRAWL_PRESENCE_ONLY',168,3),
  ('jazwtn','CRAWL_PRESENCE_ONLY',168,3),
  ('jurash','CRAWL_PRESENCE_ONLY',168,3),
  ('ksaaqar','CRAWL_PRESENCE_ONLY',168,3),
  ('masar','CRAWL_PRESENCE_ONLY',168,3),
  ('mizlaj','CRAWL_PRESENCE_ONLY',168,3),
  ('moftah','CRAWL_PRESENCE_ONLY',168,3),
  ('muktamel','CRAWL_PRESENCE_ONLY',168,3),
  ('mustqr','CRAWL_PRESENCE_ONLY',168,3),
  ('nowaisiry','CRAWL_PRESENCE_ONLY',168,3),
  ('nufouth','CRAWL_PRESENCE_ONLY',168,3),
  ('october','CRAWL_PRESENCE_ONLY',168,3),
  ('raghdan','CRAWL_PRESENCE_ONLY',168,3),
  ('rakez','CRAWL_PRESENCE_ONLY',168,3),
  ('ramzalqasim','CRAWL_PRESENCE_ONLY',168,3),
  ('rawasidark','CRAWL_PRESENCE_ONLY',168,3),
  ('remal','CRAWL_PRESENCE_ONLY',168,3),
  ('sadin','CRAWL_PRESENCE_ONLY',168,3),
  ('sadiqeltajer','CRAWL_PRESENCE_ONLY',168,3),
  ('safera','CRAWL_PRESENCE_ONLY',168,3),
  ('sakan','CRAWL_PRESENCE_ONLY',168,3),
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
where platform not in ('abeea','abralosol','abwbna','akariyoun','aldarim','alhoshan','alhumaidan','aljassim','alkhaas','almotmkenah','alobid','alshawaf','alsidra','alta','amaall','amlakalahsa','aouj','aqar','aqaralsaudia','aqaratikom','aqarcity','aqargate','aqarmonthly','aqarnajran','arkaan','awal','azdad','bahadhabab','bossbih','compoundin','dealapp','eaqartabuk','eastabha','erapulse','fahadalshahri','fursaghyr','gathern','gomenassat','gudai','hajer','ialqarawi','jazwtn','jurash','ksaaqar','masar','mizlaj','moftah','muktamel','mustqr','nowaisiry','nufouth','october','raghdan','rakez','ramzalqasim','rawasidark','remal','sadin','sadiqeltajer','safera','sakan','sanadak','satel','shmoualshmal','souq24','suwar','therc','wasalt','wslnaa');
