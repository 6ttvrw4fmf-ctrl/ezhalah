-- UN-RETIRE almuteb back to DORMANT (owner, 2026-11-04: asked "the site won't come back by itself?", then
-- «yeah do that ok»). It was retired earlier the same day (owner decision 2, «Yes, use your picks»):
-- almuteb.sa NXDOMAIN since 2026-10-23. A RETIRED platform never returns by itself; a DORMANT one is crawled
-- daily and reactivate_recovered_dormant_platforms() flips it to active on the first crawl that saves rows.
-- This restores the exact 2026-10-27 → 2026-11-04 state:
--   * platform_registry: retired -> dormant (updated_at = now(), so only a crawl AFTER this can reactivate);
--   * the 11 rows the retirement hid leave ops_adjudicated_retraction and are active again. They stay OUT of
--     search: the v2 location gate holds production_ready=false for a dormant platform, as it did before;
--   * the retirement's guarantee (20261104094609) is re-worded to the new truth — no almuteb row is adjudicated
--     any more, so mon_detect_adjudicated_reactivation has nothing of almuteb's to watch;
--   * ops_liveness_registry gets almuteb's CANDIDATE_PLUS_DIRECT row back (full reseed from
--     sql/mirrors/liveness_registry.json, 151 platforms: the latest seed 20261104181339 plus almuteb).
-- Rows are never deleted. Same transaction for every step: no instant where a row is active but adjudicated.

do $unretire$
declare
  v_status text;
  v_ids bigint[];
  v_n int;
begin
  select status into v_status from public.platform_registry where platform = 'almuteb' for update;
  if v_status is distinct from 'retired' then
    raise exception 'almuteb platform_registry status is %, expected retired — re-check before applying', v_status;
  end if;

  select array_agg(a.listing_id order by a.listing_id) into v_ids
    from public.ops_adjudicated_retraction a
   where a.source_table = 'almuteb_residential_listings'
     and a.reason = 'platform_retired_domain_does_not_resolve';
  if coalesce(cardinality(v_ids), 0) <> 11
     or exists (select 1 from public.almuteb_residential_listings t where t.id = any(v_ids) and t.active) then
    raise exception 'expected the 11 adjudicated, inactive almuteb rows of 20261104094609, found % — re-check',
      coalesce(cardinality(v_ids), 0);
  end if;

  delete from public.ops_adjudicated_retraction a
   where a.source_table = 'almuteb_residential_listings'
     and a.reason = 'platform_retired_domain_does_not_resolve'
     and a.listing_id = any(v_ids);
  get diagnostics v_n = row_count;
  if v_n <> 11 then
    raise exception 'removed % almuteb adjudications, expected 11', v_n;
  end if;

  update public.almuteb_residential_listings t set active = true, deactivated_at = null
   where t.id = any(v_ids) and not t.active;
  get diagnostics v_n = row_count;
  if v_n <> 11 then
    raise exception 'reactivated % almuteb rows, expected 11', v_n;
  end if;

  update public.ops_repair_guarantee_registry
     set invariant = 'SUPERSEDED 2026-11-04 by the owner (almuteb back to dormant, 20261104 un-retire): no almuteb row '
                  || 'is adjudicated any more; the 11 rows are active and held out of search by the dormant gate. '
                  || 'Holds while no adjudicated row comes back active.'
   where repair_version = '20261104094609';

  update public.platform_registry
     set status = 'dormant', updated_at = now(),
         notes = concat_ws(E'\n', nullif(notes, ''),
                   '[2026-11-04] retired -> dormant: owner «yeah do that ok» (a retired site never returns by itself). '
                   || 'Crawl back in the matrix; 11 rows un-adjudicated and active, hidden by the dormant gate. '
                   || 'Auto-return on the first crawl that saves rows (reactivate_recovered_dormant_platforms).')
   where platform = 'almuteb';
end
$unretire$;

-- Registry reseed from sql/mirrors/liveness_registry.json (151 platforms). The only change vs the previous seed
-- (20261104181339): almuteb is back. A full seed, because verify-liveness-registry-mirror.ts judges the LATEST seed.
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace) values
('aalbarrak','CANDIDATE_PLUS_DIRECT',168,3), ('abaad','DIRECT_REVISIT',48,3), ('abeea','CANDIDATE_PLUS_DIRECT',168,3), ('abralosol','SOURCE_LIST_PRESENCE',48,3), ('abwbna','SOURCE_LIST_PRESENCE',48,3), ('akariyoun','DIRECT_REVISIT',48,3), ('alajlan','SOURCE_LIST_PRESENCE',48,3), ('albdah','DIRECT_REVISIT',48,3), ('albukaeri','SOURCE_LIST_PRESENCE',48,3), ('aldarim','DIRECT_REVISIT',48,3), ('alhoshan','CANDIDATE_PLUS_DIRECT',168,3), ('alhumaidan','CRAWL_PRESENCE_ONLY',168,3), ('aljassim','DIRECT_REVISIT',48,3), ('alkhaas','SOURCE_LIST_PRESENCE',48,3), ('almotmkenah','DIRECT_REVISIT',48,3), ('almuteb','CANDIDATE_PLUS_DIRECT',168,3), ('alobid','SOURCE_LIST_PRESENCE',48,3), ('alqasem','CANDIDATE_PLUS_DIRECT',168,3), ('alrifai','CANDIDATE_PLUS_DIRECT',168,3), ('alsaedan','DIRECT_REVISIT',48,3), ('alshawaf','DIRECT_REVISIT',48,3), ('alsidra','CANDIDATE_PLUS_DIRECT',168,3), ('alta','CANDIDATE_PLUS_DIRECT',168,3), ('amaall','SOURCE_LIST_PRESENCE',48,3), ('amlakalahsa','SOURCE_LIST_PRESENCE',48,3), ('aouj','SOURCE_LIST_PRESENCE',48,3), ('aqalemhajer','DIRECT_REVISIT',48,3), ('aqar','DIRECT_REVISIT',48,3), ('aqaralriyadh','DIRECT_REVISIT',48,3), ('aqaralsaudia','CANDIDATE_PLUS_DIRECT',168,3), ('aqaratikom','SOURCE_LIST_PRESENCE',48,3), ('aqarcity','CANDIDATE_PLUS_DIRECT',168,3), ('aqargate','DIRECT_REVISIT',48,3), ('aqarmonthly','DIRECT_REVISIT',24,3), ('aqarnajran','SOURCE_LIST_PRESENCE',48,3), ('arkaan','SOURCE_LIST_PRESENCE',48,3), ('arsh','SOURCE_LIST_PRESENCE',48,3), ('ashab','SOURCE_LIST_PRESENCE',48,3), ('awal','SOURCE_LIST_PRESENCE',48,3), ('azdad','SOURCE_LIST_PRESENCE',48,3), ('azure','DIRECT_REVISIT',48,3), ('bahadhabab','SOURCE_LIST_PRESENCE',48,3), ('bossbih','DIRECT_REVISIT',48,3), ('compoundin','SOURCE_LIST_PRESENCE',48,3), ('dallali','SOURCE_LIST_PRESENCE',48,3), ('daraa','SOURCE_LIST_PRESENCE',48,3), ('daryusuf','DIRECT_REVISIT',48,3), ('dealapp','CANDIDATE_PLUS_DIRECT',48,3), ('dwelleo','DIRECT_REVISIT',48,3), ('eaqartabuk','DIRECT_REVISIT',48,3), ('earthapp','SOURCE_LIST_PRESENCE',48,3), ('eastabha','CANDIDATE_PLUS_DIRECT',168,3), ('ebriza','DIRECT_REVISIT',48,3), ('ego','DIRECT_REVISIT',48,3), ('eightfloor','SOURCE_LIST_PRESENCE',48,3), ('eilmalriyada','DIRECT_REVISIT',48,3), ('erapulse','SOURCE_LIST_PRESENCE',48,3), ('expattrusted','DIRECT_REVISIT',48,3), ('eydah','CANDIDATE_PLUS_DIRECT',168,3), ('fahadalshahri','SOURCE_LIST_PRESENCE',48,3), ('fkralemar','CANDIDATE_PLUS_DIRECT',168,3), ('flow','DIRECT_REVISIT',48,3), ('fursaghyr','SOURCE_LIST_PRESENCE',48,3), ('gathern','DIRECT_REVISIT',24,3), ('goldendeal','DIRECT_REVISIT',48,3), ('gomenassat','DIRECT_REVISIT',48,3), ('gudai','SOURCE_LIST_PRESENCE',48,3), ('hajer','DIRECT_REVISIT',48,3), ('haraj','DIRECT_REVISIT',48,3), ('hasaad','DIRECT_REVISIT',48,3), ('hazim','DIRECT_REVISIT',48,3), ('holoul','CANDIDATE_PLUS_DIRECT',168,3), ('ialqarawi','DIRECT_REVISIT',48,3), ('ibaax','DIRECT_REVISIT',48,3), ('jawher','CANDIDATE_PLUS_DIRECT',168,3), ('jazwtn','DIRECT_REVISIT',48,3), ('jurash','SOURCE_LIST_PRESENCE',48,3), ('justsa','DIRECT_REVISIT',48,3), ('ksaaqar','DIRECT_REVISIT',48,3), ('livingcompound','DIRECT_REVISIT',48,3), ('m3tmd','CANDIDATE_PLUS_DIRECT',168,3), ('macsaib','SOURCE_LIST_PRESENCE',48,3), ('manafe','SOURCE_LIST_PRESENCE',48,3), ('manzo','SOURCE_LIST_PRESENCE',48,3), ('maqam','DIRECT_REVISIT',48,3), ('maqrat','SOURCE_LIST_PRESENCE',48,3), ('marksa','DIRECT_REVISIT',48,3), ('masar','CANDIDATE_PLUS_DIRECT',168,3), ('mizlaj','CANDIDATE_PLUS_DIRECT',168,3), ('mobasher','SOURCE_LIST_PRESENCE',48,3), ('moftah','DIRECT_REVISIT',48,3), ('muajarh','SOURCE_LIST_PRESENCE',48,3), ('muhaysini','DIRECT_REVISIT',48,3), ('muktamel','CANDIDATE_PLUS_DIRECT',168,3), ('mustqr','DIRECT_REVISIT',48,3), ('nafithh','SOURCE_LIST_PRESENCE',48,3), ('nawafeth','SOURCE_LIST_PRESENCE',48,3), ('nofodh','DIRECT_REVISIT',48,3), ('nowaisiry','CANDIDATE_PLUS_DIRECT',168,3), ('nufouth','DIRECT_REVISIT',48,3), ('october','SOURCE_LIST_PRESENCE',48,3), ('opensooq','SOURCE_LIST_PRESENCE',48,3), ('propertyfinder','SOURCE_LIST_PRESENCE',48,3), ('qmra','DIRECT_REVISIT',48,3), ('raghdan','DIRECT_REVISIT',48,3), ('rakez','DIRECT_REVISIT',48,3), ('ramzalqasim','SOURCE_LIST_PRESENCE',48,3), ('rawaf','SOURCE_LIST_PRESENCE',48,3), ('rawasidark','SOURCE_LIST_PRESENCE',48,3), ('razre','DIRECT_REVISIT',48,3), ('reinvest','DIRECT_REVISIT',48,3), ('remal','SOURCE_LIST_PRESENCE',48,3), ('remaxsa','DIRECT_REVISIT',48,3), ('rightcompound','DIRECT_REVISIT',48,3), ('ryadah','SOURCE_LIST_PRESENCE',48,3), ('sadin','CRAWL_PRESENCE_ONLY',168,3), ('sadiqeltajer','DIRECT_REVISIT',48,3), ('safa','DIRECT_REVISIT',48,3), ('safera','SOURCE_LIST_PRESENCE',48,3), ('sakan','CANDIDATE_PLUS_DIRECT',168,1), ('sakani','CANDIDATE_PLUS_DIRECT',168,3), ('sanadak','CANDIDATE_PLUS_DIRECT',168,3), ('satel','SOURCE_LIST_PRESENCE',48,3), ('senan','CANDIDATE_PLUS_DIRECT',168,3), ('shatri','DIRECT_REVISIT',48,3), ('shmoualshmal','SOURCE_LIST_PRESENCE',48,3), ('sirdab','SOURCE_LIST_PRESENCE',48,3), ('snam','DIRECT_REVISIT',48,3), ('sodasyat','DIRECT_REVISIT',48,3), ('sokok','DIRECT_REVISIT',48,3), ('souq24','DIRECT_REVISIT',48,3), ('sqcc','CANDIDATE_PLUS_DIRECT',168,3), ('squares','SOURCE_LIST_PRESENCE',48,3), ('sukna','DIRECT_REVISIT',48,3), ('superoffice','SOURCE_LIST_PRESENCE',48,3), ('shomou','SOURCE_LIST_PRESENCE',48,3), ('maktab','SOURCE_LIST_PRESENCE',48,3), ('suwar','DIRECT_REVISIT',48,3), ('tamyaz','DIRECT_REVISIT',48,3), ('tawia','SOURCE_LIST_PRESENCE',48,3), ('therc','CANDIDATE_PLUS_DIRECT',168,3), ('thousand','CANDIDATE_PLUS_DIRECT',168,3), ('tuba','DIRECT_REVISIT',48,3), ('villassa','DIRECT_REVISIT',48,3), ('vmksa','SOURCE_LIST_PRESENCE',48,3), ('wadod','DIRECT_REVISIT',48,3), ('wahadat','SOURCE_LIST_PRESENCE',48,3), ('wajaf','SOURCE_LIST_PRESENCE',48,3), ('wasalt','DIRECT_REVISIT',48,3), ('wslnaa','SOURCE_LIST_PRESENCE',48,3), ('yameen','DIRECT_REVISIT',48,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;
delete from public.ops_liveness_registry
where platform not in ('aalbarrak','abaad','abeea','abralosol','abwbna','akariyoun','alajlan','albdah','albukaeri','aldarim','alhoshan','alhumaidan','aljassim','alkhaas','almotmkenah','almuteb','alobid','alqasem','alrifai','alsaedan','alshawaf','alsidra','alta','amaall','amlakalahsa','aouj','aqalemhajer','aqar','aqaralriyadh','aqaralsaudia','aqaratikom','aqarcity','aqargate','aqarmonthly','aqarnajran','arkaan','arsh','ashab','awal','azdad','azure','bahadhabab','bossbih','compoundin','dallali','daraa','daryusuf','dealapp','dwelleo','eaqartabuk','earthapp','eastabha','ebriza','ego','eightfloor','eilmalriyada','erapulse','expattrusted','eydah','fahadalshahri','fkralemar','flow','fursaghyr','gathern','goldendeal','gomenassat','gudai','hajer','haraj','hasaad','hazim','holoul','ialqarawi','ibaax','jawher','jazwtn','jurash','justsa','ksaaqar','livingcompound','m3tmd','macsaib','manafe','manzo','maqam','maqrat','marksa','masar','mizlaj','mobasher','moftah','muajarh','muhaysini','muktamel','mustqr','nafithh','nawafeth','nofodh','nowaisiry','nufouth','october','opensooq','propertyfinder','qmra','raghdan','rakez','ramzalqasim','rawaf','rawasidark','razre','reinvest','remal','remaxsa','rightcompound','ryadah','sadin','sadiqeltajer','safa','safera','sakan','sakani','sanadak','satel','senan','shatri','shmoualshmal','sirdab','snam','sodasyat','sokok','souq24','sqcc','squares','sukna','superoffice','shomou','maktab','suwar','tamyaz','tawia','therc','thousand','tuba','villassa','vmksa','wadod','wahadat','wajaf','wasalt','wslnaa','yameen');