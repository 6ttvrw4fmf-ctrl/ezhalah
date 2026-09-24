-- The thirty-five platforms join the liveness registry — a FULL RESEED.
-- verify-liveness-registry-mirror.ts requires the LATEST registry-seed migration to be the COMPLETE
-- registry plus a delete clause: an insert-only seed cannot retire a platform, so the dashboard
-- would keep reporting coverage for inventory nothing verifies any more.
--
-- Based on the LIVE table, introspected read-only 2026-09-24 15:02 UTC: ops_liveness_registry held
-- exactly the 69 rows of the committed sql/mirrors/liveness_registry.json (same strategy/sla/grace on
-- every one, the 20260921203203 retier included), so this reseed changes NOTHING for them and adds
-- the thirty-five below.
--
-- ALL THIRTY-FIVE ARE CANDIDATE_PLUS_DIRECT / 168h / grace 3: each run.py hands db.prune_unseen a
-- verify_gone= oracle measured live against that platform's own gone ids with live controls (the
-- REMOVAL ORACLE block of each scraper, and the registry migration
-- …_thirty_five_platforms_registry_and_liveness). None of them deactivates on absence alone, and the
-- ones whose obvious policy is wrong — alrifai / justsa / marksa / flow (a gone id is an HTTP 200
-- shell), villassa (status "0" on an intact record), sodasyat (a 302), albdah (a Django DEBUG 500),
-- dwelleo (a 422), hasaad (a 404 only with WordPress's own error404 marker) and the ten API-backed
-- sites whose HTML page is a soft-404 shell — are named there.
--
-- Generated from sql/mirrors/liveness_registry.json so the SQL, the JSON mirror and
-- scrapers/common/liveness_policies.py cannot disagree.
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace) values
  ('aalbarrak','CANDIDATE_PLUS_DIRECT',168,3),
  ('abeea','CANDIDATE_PLUS_DIRECT',168,3),
  ('abralosol','CRAWL_PRESENCE_ONLY',168,3),
  ('abwbna','CRAWL_PRESENCE_ONLY',168,3),
  ('akariyoun','CANDIDATE_PLUS_DIRECT',168,3),
  ('albdah','CANDIDATE_PLUS_DIRECT',168,3),
  ('aldarim','CANDIDATE_PLUS_DIRECT',168,3),
  ('alhoshan','CRAWL_PRESENCE_ONLY',168,3),
  ('alhumaidan','CRAWL_PRESENCE_ONLY',168,3),
  ('aljassim','CANDIDATE_PLUS_DIRECT',168,3),
  ('alkhaas','CRAWL_PRESENCE_ONLY',168,3),
  ('almotmkenah','CANDIDATE_PLUS_DIRECT',168,3),
  ('almuteb','CANDIDATE_PLUS_DIRECT',168,3),
  ('alobid','CRAWL_PRESENCE_ONLY',168,3),
  ('alqasem','CANDIDATE_PLUS_DIRECT',168,3),
  ('alrifai','CANDIDATE_PLUS_DIRECT',168,3),
  ('alshawaf','CANDIDATE_PLUS_DIRECT',168,3),
  ('alsidra','CANDIDATE_PLUS_DIRECT',168,3),
  ('alta','CRAWL_PRESENCE_ONLY',168,3),
  ('amaall','CRAWL_PRESENCE_ONLY',168,3),
  ('amlakalahsa','CRAWL_PRESENCE_ONLY',168,3),
  ('aouj','CRAWL_PRESENCE_ONLY',168,3),
  ('aqalemhajer','CANDIDATE_PLUS_DIRECT',168,3),
  ('aqar','DIRECT_REVISIT',48,3),
  ('aqaralriyadh','CANDIDATE_PLUS_DIRECT',168,3),
  ('aqaralsaudia','CANDIDATE_PLUS_DIRECT',168,3),
  ('aqaratikom','CRAWL_PRESENCE_ONLY',168,3),
  ('aqarcity','CANDIDATE_PLUS_DIRECT',168,3),
  ('aqargate','CANDIDATE_PLUS_DIRECT',168,3),
  ('aqarmonthly','CRAWL_PRESENCE_ONLY',168,3),
  ('aqarnajran','CRAWL_PRESENCE_ONLY',168,3),
  ('arkaan','CRAWL_PRESENCE_ONLY',168,3),
  ('awal','CRAWL_PRESENCE_ONLY',168,3),
  ('azdad','CRAWL_PRESENCE_ONLY',168,3),
  ('azure','CANDIDATE_PLUS_DIRECT',168,3),
  ('bahadhabab','CRAWL_PRESENCE_ONLY',168,3),
  ('bossbih','CANDIDATE_PLUS_DIRECT',168,3),
  ('compoundin','CRAWL_PRESENCE_ONLY',168,3),
  ('daryusuf','CANDIDATE_PLUS_DIRECT',168,3),
  ('dealapp','CANDIDATE_PLUS_DIRECT',96,3),
  ('dwelleo','CANDIDATE_PLUS_DIRECT',168,3),
  ('eaqartabuk','CRAWL_PRESENCE_ONLY',168,3),
  ('eastabha','CANDIDATE_PLUS_DIRECT',168,3),
  ('ebriza','CANDIDATE_PLUS_DIRECT',168,3),
  ('eilmalriyada','CANDIDATE_PLUS_DIRECT',168,3),
  ('erapulse','CRAWL_PRESENCE_ONLY',168,3),
  ('expattrusted','CANDIDATE_PLUS_DIRECT',168,3),
  ('eydah','CANDIDATE_PLUS_DIRECT',168,3),
  ('fahadalshahri','CRAWL_PRESENCE_ONLY',168,3),
  ('fkralemar','CANDIDATE_PLUS_DIRECT',168,3),
  ('flow','CANDIDATE_PLUS_DIRECT',168,3),
  ('fursaghyr','CRAWL_PRESENCE_ONLY',168,3),
  ('gathern','DIRECT_REVISIT',96,3),
  ('goldendeal','CANDIDATE_PLUS_DIRECT',168,3),
  ('gomenassat','CANDIDATE_PLUS_DIRECT',168,3),
  ('gudai','CRAWL_PRESENCE_ONLY',168,3),
  ('hajer','CANDIDATE_PLUS_DIRECT',168,3),
  ('hasaad','CANDIDATE_PLUS_DIRECT',168,3),
  ('hazim','CANDIDATE_PLUS_DIRECT',168,3),
  ('ialqarawi','CANDIDATE_PLUS_DIRECT',168,3),
  ('jawher','CANDIDATE_PLUS_DIRECT',168,3),
  ('jazwtn','CANDIDATE_PLUS_DIRECT',168,3),
  ('jurash','CRAWL_PRESENCE_ONLY',168,3),
  ('justsa','CANDIDATE_PLUS_DIRECT',168,3),
  ('ksaaqar','CRAWL_PRESENCE_ONLY',168,3),
  ('livingcompound','CANDIDATE_PLUS_DIRECT',168,3),
  ('m3tmd','CANDIDATE_PLUS_DIRECT',168,3),
  ('marksa','CANDIDATE_PLUS_DIRECT',168,3),
  ('masar','CANDIDATE_PLUS_DIRECT',168,3),
  ('mizlaj','CANDIDATE_PLUS_DIRECT',168,3),
  ('moftah','CANDIDATE_PLUS_DIRECT',168,3),
  ('muktamel','CANDIDATE_PLUS_DIRECT',168,3),
  ('mustqr','CANDIDATE_PLUS_DIRECT',168,3),
  ('nowaisiry','CANDIDATE_PLUS_DIRECT',168,3),
  ('nufouth','CANDIDATE_PLUS_DIRECT',168,3),
  ('october','CRAWL_PRESENCE_ONLY',168,3),
  ('raghdan','CANDIDATE_PLUS_DIRECT',168,3),
  ('rakez','CANDIDATE_PLUS_DIRECT',168,3),
  ('ramzalqasim','CRAWL_PRESENCE_ONLY',168,3),
  ('rawasidark','CRAWL_PRESENCE_ONLY',168,3),
  ('remal','CRAWL_PRESENCE_ONLY',168,3),
  ('rightcompound','CANDIDATE_PLUS_DIRECT',168,3),
  ('sadin','CRAWL_PRESENCE_ONLY',168,3),
  ('sadiqeltajer','CRAWL_PRESENCE_ONLY',168,3),
  ('safera','CRAWL_PRESENCE_ONLY',168,3),
  ('sakan','CANDIDATE_PLUS_DIRECT',168,3),
  ('sakani','CANDIDATE_PLUS_DIRECT',168,3),
  ('sanadak','CANDIDATE_PLUS_DIRECT',168,3),
  ('satel','CRAWL_PRESENCE_ONLY',168,3),
  ('senan','CANDIDATE_PLUS_DIRECT',168,3),
  ('shatri','CANDIDATE_PLUS_DIRECT',168,3),
  ('shmoualshmal','CRAWL_PRESENCE_ONLY',168,3),
  ('snam','CANDIDATE_PLUS_DIRECT',168,3),
  ('sodasyat','CANDIDATE_PLUS_DIRECT',168,3),
  ('souq24','CANDIDATE_PLUS_DIRECT',168,3),
  ('suwar','CANDIDATE_PLUS_DIRECT',168,3),
  ('tamyaz','CANDIDATE_PLUS_DIRECT',168,3),
  ('therc','CRAWL_PRESENCE_ONLY',168,3),
  ('thousand','CANDIDATE_PLUS_DIRECT',168,3),
  ('villassa','CANDIDATE_PLUS_DIRECT',168,3),
  ('wadod','CANDIDATE_PLUS_DIRECT',168,3),
  ('wasalt','DIRECT_REVISIT',96,3),
  ('wslnaa','CRAWL_PRESENCE_ONLY',168,3),
  ('yameen','CANDIDATE_PLUS_DIRECT',168,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;

delete from public.ops_liveness_registry
where platform not in ('aalbarrak','abeea','abralosol','abwbna','akariyoun','albdah','aldarim','alhoshan','alhumaidan','aljassim','alkhaas','almotmkenah','almuteb','alobid','alqasem','alrifai','alshawaf','alsidra','alta','amaall','amlakalahsa','aouj','aqalemhajer','aqar','aqaralriyadh','aqaralsaudia','aqaratikom','aqarcity','aqargate','aqarmonthly','aqarnajran','arkaan','awal','azdad','azure','bahadhabab','bossbih','compoundin','daryusuf','dealapp','dwelleo','eaqartabuk','eastabha','ebriza','eilmalriyada','erapulse','expattrusted','eydah','fahadalshahri','fkralemar','flow','fursaghyr','gathern','goldendeal','gomenassat','gudai','hajer','hasaad','hazim','ialqarawi','jawher','jazwtn','jurash','justsa','ksaaqar','livingcompound','m3tmd','marksa','masar','mizlaj','moftah','muktamel','mustqr','nowaisiry','nufouth','october','raghdan','rakez','ramzalqasim','rawasidark','remal','rightcompound','sadin','sadiqeltajer','safera','sakan','sakani','sanadak','satel','senan','shatri','shmoualshmal','snam','sodasyat','souq24','suwar','tamyaz','therc','thousand','villassa','wadod','wasalt','wslnaa','yameen');
