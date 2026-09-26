-- eaqartabuk: CRAWL_PRESENCE_ONLY -> CANDIDATE_PLUS_DIRECT.
--
-- Routine #11 (listing lifecycle), 2026-09-26, alert_event 5923 (P1 unknown_treated_as_dead).
--
-- WHAT WAS WRONG. scrapers/eaqartabuk/run.py called db.prune_unseen() with NO verify_gone=, so
-- crawl ABSENCE alone deactivated a listing after 3 misses -- the inference
-- docs/ops/LISTING_LIVENESS.md SS1-SS3 forbids. All four rows this platform has ever deactivated
-- carry last_verified_alive_at IS NULL and no GONE probe: the source never once spoke.
--
-- WHAT SHIPPED WITH THIS MIGRATION (same change, per AGENTS.md "PLATFORM ACTIVATION IS
-- APPLY-AND-MIRROR IN ONE CHANGE"): scrapers/eaqartabuk/run.py::_verify_gone, a DIRECT
-- per-listing oracle on the property's own public record, handed to prune_unseen. Absence now
-- only SELECTS a candidate; only the source may kill it.
--
-- THE SIGNAL, measured live 2026-09-26 through the shipped function, 9/9 with live controls
-- interleaved:
--   HTTP 403 rh_not_public  -> gone     (withdrawn; ids 10221, 10306)
--   HTTP 404 rh_not_found   -> gone     (deleted;   id 10181, and a never-existing 999999)
--   HTTP 200 + id echoed    -> live     (ids 8329, 5664, 5702, 5727)
--   anything else           -> unknown  (holds the strike, deactivates nothing)
-- A 403 or 404 carrying no such code -- an edge block, a WAF, a rate-limiter -- is UNKNOWN. That
-- distinction is the safety margin: a blocked run and a withdrawn ad both answer 403.
--
-- THE ENDPOINT THIS SCRAPER ALREADY CALLS "AUTHORITATIVE" WOULD HAVE LIED: candles-map/v1
-- answers HTTP 200 with a full record for a WITHDRAWN property, so an oracle built on it would
-- have certified every dead ad ALIVE -- the aqargate/abeea trap. Pinned by
-- scripts/verify-eaqartabuk-liveness-oracle.ts, which EXECUTES the lifted predicate.
--
-- ADJUDICATION OF THE EXISTING 4 INACTIVE ROWS (DIRECT re-probe, same run): ET10221, ET10306 and
-- ET10181 are genuinely gone at source -- the deactivations were correct in OUTCOME, and
-- unevidenced in RECORD, which is what this fixes going forward. ET8329 is LIVE at source and is
-- NOT restored: its active commercial sibling serves the same listing_url after a category flip,
-- so restoring it would recreate the duplicate card migration 20260830140110 repaired. Zero false
-- deactivations found; nothing was deleted, no kill was widened and no floor was lowered.
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
  ('eaqartabuk','CANDIDATE_PLUS_DIRECT',168,3),
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
  SELECT strategy INTO s FROM public.ops_liveness_registry WHERE platform = 'eaqartabuk';
  IF s IS DISTINCT FROM 'CANDIDATE_PLUS_DIRECT' THEN
    RAISE EXCEPTION 'eaqartabuk strategy is %, expected CANDIDATE_PLUS_DIRECT', s;
  END IF;
  RAISE NOTICE 'eaqartabuk upgraded to CANDIDATE_PLUS_DIRECT';
END $verify$;
