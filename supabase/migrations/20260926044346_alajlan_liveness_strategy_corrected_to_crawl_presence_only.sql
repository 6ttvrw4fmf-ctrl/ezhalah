-- Correct alajlan's liveness strategy: CANDIDATE_PLUS_DIRECT -> CRAWL_PRESENCE_ONLY.
--
-- verify-liveness-registry-mirror caught this immediately after the previous reseed
-- (20260926043801) shipped it wrong: alajlan has NO direct-revisit code path (no
-- scrapers/alajlan/liveness{,_run}.py, no verify_gone= handed to prune_unseen) and can never
-- have one — there is no per-listing URL to re-query. Every run re-fetches the platform's ENTIRE
-- catalogue in one shot, and that one fetch already IS the complete answer (status:true/false/
-- absent), with no separate candidate-selection step and no separate direct-confirm step. That is
-- CRAWL_PRESENCE_ONLY's code shape, even though the signal is stronger than most CRAWL_PRESENCE_
-- ONLY platforms get (a real status flip, not just absence) — the tier describes the CODE PATH
-- that exists, not the confidence of the signal.
--
-- Full reseed, not one UPDATE, for the same reason as every prior reseed: this migration's own
-- content IS the three-way-mirror source of truth alongside liveness_policies.py and the JSON
-- mirror, and the delete clause is what lets a platform be retired later without a hand-edit.
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace) values
  ('aalbarrak','CANDIDATE_PLUS_DIRECT',168,3),
  ('abaad','CANDIDATE_PLUS_DIRECT',168,3),
  ('abeea','CANDIDATE_PLUS_DIRECT',168,3),
  ('abralosol','CRAWL_PRESENCE_ONLY',168,3),
  ('abwbna','CRAWL_PRESENCE_ONLY',168,3),
  ('akariyoun','CANDIDATE_PLUS_DIRECT',168,3),
  ('alajlan','CRAWL_PRESENCE_ONLY',168,3),
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
  ('alsaedan','CANDIDATE_PLUS_DIRECT',168,3),
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
  ('ego','CANDIDATE_PLUS_DIRECT',168,3),
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
  ('ibaax','CANDIDATE_PLUS_DIRECT',168,3),
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
  ('muhaysini','CANDIDATE_PLUS_DIRECT',168,3),
  ('muktamel','CANDIDATE_PLUS_DIRECT',168,3),
  ('mustqr','CANDIDATE_PLUS_DIRECT',168,3),
  ('nofodh','CANDIDATE_PLUS_DIRECT',168,3),
  ('nowaisiry','CANDIDATE_PLUS_DIRECT',168,3),
  ('nufouth','CANDIDATE_PLUS_DIRECT',168,3),
  ('october','CRAWL_PRESENCE_ONLY',168,3),
  ('qmra','CANDIDATE_PLUS_DIRECT',168,3),
  ('raghdan','CANDIDATE_PLUS_DIRECT',168,3),
  ('rakez','CANDIDATE_PLUS_DIRECT',168,3),
  ('ramzalqasim','CRAWL_PRESENCE_ONLY',168,3),
  ('rawasidark','CRAWL_PRESENCE_ONLY',168,3),
  ('razre','CANDIDATE_PLUS_DIRECT',168,3),
  ('reinvest','CANDIDATE_PLUS_DIRECT',168,3),
  ('remal','CRAWL_PRESENCE_ONLY',168,3),
  ('remaxsa','CANDIDATE_PLUS_DIRECT',168,3),
  ('rightcompound','CANDIDATE_PLUS_DIRECT',168,3),
  ('sadin','CRAWL_PRESENCE_ONLY',168,3),
  ('sadiqeltajer','CRAWL_PRESENCE_ONLY',168,3),
  ('safa','CANDIDATE_PLUS_DIRECT',168,3),
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
  ('sokok','CANDIDATE_PLUS_DIRECT',168,3),
  ('souq24','CANDIDATE_PLUS_DIRECT',168,3),
  ('sukna','CANDIDATE_PLUS_DIRECT',168,3),
  ('suwar','CANDIDATE_PLUS_DIRECT',168,3),
  ('tamyaz','CANDIDATE_PLUS_DIRECT',168,3),
  ('therc','CRAWL_PRESENCE_ONLY',168,3),
  ('thousand','CANDIDATE_PLUS_DIRECT',168,3),
  ('tuba','CANDIDATE_PLUS_DIRECT',168,3),
  ('villassa','CANDIDATE_PLUS_DIRECT',168,3),
  ('wadod','CANDIDATE_PLUS_DIRECT',168,3),
  ('wasalt','DIRECT_REVISIT',96,3),
  ('wslnaa','CRAWL_PRESENCE_ONLY',168,3),
  ('yameen','CANDIDATE_PLUS_DIRECT',168,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;

delete from public.ops_liveness_registry
where platform not in ('aalbarrak','abaad','abeea','abralosol','abwbna','akariyoun','alajlan','albdah','aldarim','alhoshan','alhumaidan','aljassim','alkhaas','almotmkenah','almuteb','alobid','alqasem','alrifai','alsaedan','alshawaf','alsidra','alta','amaall','amlakalahsa','aouj','aqalemhajer','aqar','aqaralriyadh','aqaralsaudia','aqaratikom','aqarcity','aqargate','aqarmonthly','aqarnajran','arkaan','awal','azdad','azure','bahadhabab','bossbih','compoundin','daryusuf','dealapp','dwelleo','eaqartabuk','eastabha','ebriza','ego','eilmalriyada','erapulse','expattrusted','eydah','fahadalshahri','fkralemar','flow','fursaghyr','gathern','goldendeal','gomenassat','gudai','hajer','hasaad','hazim','ialqarawi','ibaax','jawher','jazwtn','jurash','justsa','ksaaqar','livingcompound','m3tmd','marksa','masar','mizlaj','moftah','muhaysini','muktamel','mustqr','nofodh','nowaisiry','nufouth','october','qmra','raghdan','rakez','ramzalqasim','rawasidark','razre','reinvest','remal','remaxsa','rightcompound','sadin','sadiqeltajer','safa','safera','sakan','sakani','sanadak','satel','senan','shatri','shmoualshmal','snam','sodasyat','sokok','souq24','sukna','suwar','tamyaz','therc','thousand','tuba','villassa','wadod','wasalt','wslnaa','yameen');

DO $verify$
DECLARE s text;
BEGIN
  SELECT strategy INTO s FROM public.ops_liveness_registry WHERE platform = 'alajlan';
  IF s IS DISTINCT FROM 'CRAWL_PRESENCE_ONLY' THEN
    RAISE EXCEPTION 'alajlan strategy is %, expected CRAWL_PRESENCE_ONLY', s;
  END IF;
  RAISE NOTICE 'alajlan corrected to CRAWL_PRESENCE_ONLY';
END $verify$;
