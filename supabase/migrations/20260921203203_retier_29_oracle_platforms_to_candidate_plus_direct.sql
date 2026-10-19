-- THE TIER GRADES THE MECHANISM, AND 29 PLATFORMS WERE GRADED BELOW THE ONE THEY RUN.
-- ops_incident #248 / #578. A FULL RESEED, because verify-liveness-registry-mirror.ts requires the
-- LATEST registry-seed migration to be the COMPLETE registry plus a delete clause: an insert-only
-- seed cannot retire a platform.
--
-- WHAT CHANGED: 29 platforms move CRAWL_PRESENCE_ONLY -> CANDIDATE_PLUS_DIRECT. Nothing else moves;
-- sla_hours and grace are untouched on every row, and no platform joins or leaves the registry.
--
-- WHY. CRAWL_PRESENCE_ONLY is defined in liveness_policies.py as "We only know the ad was in the
-- crawl", and CANDIDATE_PLUS_DIRECT as "an absence signal selects candidates cheaply; each
-- candidate then gets a DIRECT re-fetch before anything is deactivated". Each of these 29 passes
-- verify_gone= to db.prune_unseen(), so a row at grace is re-fetched on its OWN url and only an
-- affirmative source answer may deactivate it. The second sentence describes them exactly; the
-- first is false about them. Their own registry notes already said so, inside the same row whose
-- strategy field contradicted it.
--
-- WHY IT WAS WRONG FOR SO LONG, and why this lands with the db.py fix rather than after it:
-- prune_unseen's self-heal wrote {missing_count, last_seen_at} and discarded the ALIVE verdict, so
-- last_verified_alive_at stayed NULL no matter how well an oracle ran. Measured 2026-09-21 across
-- the fleet: 63 of 67 platforms holding active inventory had NEVER written one, while nine of them
-- (abeea, akariyoun, aqarcity, aqargate, hajer, mustqr, raghdan, rakez, sanadak) had already
-- produced real direct verdicts through that call site -- 267 LIVE and 71 GONE on rakez alone.
-- So the data agreed with the wrong tier, and mon_detect_liveness_coverage_ramp -- the one detector
-- for "its liveness job is not running, or is running and writing nothing" -- filters on
-- `strategy in ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT')` and therefore never looked at any of
-- them. A self-consistent blind spot: exactly the shape LISTING_LIVENESS.md 9.2 names.
--
-- WHAT THIS IS NOT. It is not a coverage claim. A tier says what the platform RUNS; whether that
-- chain has actually produced evidence in production is the separate question, and for 20 of these
-- 29 the answer today is "never observed" -- recorded as such in scrapers/oracle-never-observed.txt
-- rather than quietly counted as covered (owner rule 2026-09-21: "Do not mark a platform as covered
-- merely because code exists"). Those 20 now become VISIBLE to the coverage monitors, which is the
-- point.
--
-- Generated from sql/mirrors/liveness_registry.json so the SQL, the JSON mirror and
-- scrapers/common/liveness_policies.py cannot disagree.
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace) values
  ('abeea','CANDIDATE_PLUS_DIRECT',168,3),
  ('abralosol','CRAWL_PRESENCE_ONLY',168,3),
  ('abwbna','CRAWL_PRESENCE_ONLY',168,3),
  ('akariyoun','CANDIDATE_PLUS_DIRECT',168,3),
  ('aldarim','CANDIDATE_PLUS_DIRECT',168,3),
  ('alhoshan','CRAWL_PRESENCE_ONLY',168,3),
  ('alhumaidan','CRAWL_PRESENCE_ONLY',168,3),
  ('aljassim','CANDIDATE_PLUS_DIRECT',168,3),
  ('alkhaas','CRAWL_PRESENCE_ONLY',168,3),
  ('almotmkenah','CANDIDATE_PLUS_DIRECT',168,3),
  ('alobid','CRAWL_PRESENCE_ONLY',168,3),
  ('alshawaf','CANDIDATE_PLUS_DIRECT',168,3),
  ('alsidra','CANDIDATE_PLUS_DIRECT',168,3),
  ('alta','CRAWL_PRESENCE_ONLY',168,3),
  ('amaall','CRAWL_PRESENCE_ONLY',168,3),
  ('amlakalahsa','CRAWL_PRESENCE_ONLY',168,3),
  ('aouj','CRAWL_PRESENCE_ONLY',168,3),
  ('aqar','DIRECT_REVISIT',48,3),
  ('aqaralsaudia','CANDIDATE_PLUS_DIRECT',168,3),
  ('aqaratikom','CRAWL_PRESENCE_ONLY',168,3),
  ('aqarcity','CANDIDATE_PLUS_DIRECT',168,3),
  ('aqargate','CANDIDATE_PLUS_DIRECT',168,3),
  ('aqarmonthly','CRAWL_PRESENCE_ONLY',168,3),
  ('aqarnajran','CRAWL_PRESENCE_ONLY',168,3),
  ('arkaan','CRAWL_PRESENCE_ONLY',168,3),
  ('awal','CRAWL_PRESENCE_ONLY',168,3),
  ('azdad','CRAWL_PRESENCE_ONLY',168,3),
  ('bahadhabab','CRAWL_PRESENCE_ONLY',168,3),
  ('bossbih','CANDIDATE_PLUS_DIRECT',168,3),
  ('compoundin','CRAWL_PRESENCE_ONLY',168,3),
  ('dealapp','CANDIDATE_PLUS_DIRECT',96,3),
  ('eaqartabuk','CRAWL_PRESENCE_ONLY',168,3),
  ('eastabha','CANDIDATE_PLUS_DIRECT',168,3),
  ('erapulse','CRAWL_PRESENCE_ONLY',168,3),
  ('fahadalshahri','CRAWL_PRESENCE_ONLY',168,3),
  ('fursaghyr','CRAWL_PRESENCE_ONLY',168,3),
  ('gathern','DIRECT_REVISIT',96,3),
  ('gomenassat','CANDIDATE_PLUS_DIRECT',168,3),
  ('gudai','CRAWL_PRESENCE_ONLY',168,3),
  ('hajer','CANDIDATE_PLUS_DIRECT',168,3),
  ('ialqarawi','CANDIDATE_PLUS_DIRECT',168,3),
  ('jazwtn','CANDIDATE_PLUS_DIRECT',168,3),
  ('jurash','CRAWL_PRESENCE_ONLY',168,3),
  ('ksaaqar','CRAWL_PRESENCE_ONLY',168,3),
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
  ('sadin','CRAWL_PRESENCE_ONLY',168,3),
  ('sadiqeltajer','CRAWL_PRESENCE_ONLY',168,3),
  ('safera','CRAWL_PRESENCE_ONLY',168,3),
  ('sakan','CANDIDATE_PLUS_DIRECT',168,3),
  ('sanadak','CANDIDATE_PLUS_DIRECT',168,3),
  ('satel','CRAWL_PRESENCE_ONLY',168,3),
  ('shmoualshmal','CRAWL_PRESENCE_ONLY',168,3),
  ('souq24','CANDIDATE_PLUS_DIRECT',168,3),
  ('suwar','CANDIDATE_PLUS_DIRECT',168,3),
  ('therc','CRAWL_PRESENCE_ONLY',168,3),
  ('wasalt','DIRECT_REVISIT',96,3),
  ('wslnaa','CRAWL_PRESENCE_ONLY',168,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;

delete from public.ops_liveness_registry
where platform not in ('abeea','abralosol','abwbna','akariyoun','aldarim','alhoshan','alhumaidan','aljassim','alkhaas','almotmkenah','alobid','alshawaf','alsidra','alta','amaall','amlakalahsa','aouj','aqar','aqaralsaudia','aqaratikom','aqarcity','aqargate','aqarmonthly','aqarnajran','arkaan','awal','azdad','bahadhabab','bossbih','compoundin','dealapp','eaqartabuk','eastabha','erapulse','fahadalshahri','fursaghyr','gathern','gomenassat','gudai','hajer','ialqarawi','jazwtn','jurash','ksaaqar','masar','mizlaj','moftah','muktamel','mustqr','nowaisiry','nufouth','october','raghdan','rakez','ramzalqasim','rawasidark','remal','sadin','sadiqeltajer','safera','sakan','sanadak','satel','shmoualshmal','souq24','suwar','therc','wasalt','wslnaa');
