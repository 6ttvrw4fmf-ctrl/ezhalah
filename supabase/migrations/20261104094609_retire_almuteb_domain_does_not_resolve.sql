-- RETIRE almuteb (owner «Yes, use your picks», decision 2, 2026-11-04): almuteb.sa has not resolved in DNS
-- since 2026-10-23. Evidence: every crawl since 2026-10-24 04:39 UTC failed with curl(6) «Could not resolve
-- host: almuteb.sa» (scrape_runs; newest 2026-11-04 08:25); re-measured 2026-11-04 — almuteb.sa and
-- www.almuteb.sa answer NXDOMAIN from the local resolver, 8.8.8.8 and 1.1.1.1, and the .sa registry (whois
-- whois.nic.net.sa) lists its name servers as NS1/NS2.DNS-PARKING.COM. The platform was already «dormant»
-- (2026-10-27); this makes it «retired» (only the owner changes that) and hides its 11 listings, last seen
-- 2026-10-23 04:39 UTC.
--
-- Rows are KEPT, never deleted. Each hidden row is registered in ops_adjudicated_retraction with the DNS
-- evidence, so auto_recover_false_inactive() cannot read the decision as an accident;
-- mon_detect_adjudicated_reactivation() watches for a row coming back. The crawl leaves the
-- small-sources matrix and the slug joins scrapers/RETIRED_PLATFORMS.txt in the same change.

do $retire$
declare
  v_n int;
  v_done int;
  v_status text;
  v_ids bigint[];
begin
  select status into v_status from public.platform_registry where platform = 'almuteb' for update;
  if v_status is distinct from 'dormant' then
    raise exception 'almuteb platform_registry status is %, expected dormant — re-adjudicate before applying', v_status;
  end if;

  -- No temp table (DDL would make PostgREST reload its schema cache): the ids are held in an array.
  select array_agg(t.id order by t.id) into v_ids
    from public.almuteb_residential_listings t
   where t.active and t.last_seen_at < timestamptz '2026-10-24 00:00:00+00';
  v_n := coalesce(cardinality(v_ids), 0);
  if v_n <> 11
     or exists (select 1 from public.almuteb_residential_listings t where t.active and t.last_seen_at >= timestamptz '2026-10-24 00:00:00+00')
     or exists (select 1 from public.almuteb_commercial_listings c where c.active) then
    raise exception 'expected exactly 11 active almuteb rows, all last seen before 2026-10-24, found % — re-adjudicate', v_n;
  end if;

  update public.almuteb_residential_listings t set active = false, deactivated_at = now()
   where t.id = any(v_ids) and t.active;
  get diagnostics v_done = row_count;
  if v_done <> 11 then
    raise exception 'deactivated % almuteb rows, expected 11', v_done;
  end if;

  -- Same transaction as the flip: no committed instant in which a hidden row is unadjudicated.
  insert into public.ops_adjudicated_retraction (source_table, listing_id, reason, evidence)
  select 'almuteb_residential_listings', r.id, 'platform_retired_domain_does_not_resolve',
         jsonb_build_object(
           'owner_decision', 'owner «Yes, use your picks», decision 2, 2026-11-04: retire almuteb and hide its 11 listings',
           'ad_number', r.ad_number, 'listing_url', r.listing_url, 'last_seen_at', r.last_seen_at,
           'dns', jsonb_build_object(
             'measured_at', '2026-11-04',
             'almuteb.sa', 'NXDOMAIN (local resolver, 8.8.8.8, 1.1.1.1)',
             'www.almuteb.sa', 'NXDOMAIN',
             'registry_nameservers', 'NS1.DNS-PARKING.COM, NS2.DNS-PARKING.COM (whois.nic.net.sa)'),
           'crawls', 'every almuteb crawl since 2026-10-24 04:39 UTC failed: curl(6) Could not resolve host: almuteb.sa')
    from public.almuteb_residential_listings r where r.id = any(v_ids);

  update public.platform_registry
     set status = 'retired', updated_at = now(),
         notes = concat_ws(E'\n', nullif(notes, ''),
                   '[2026-11-04] dormant -> retired: owner «Yes, use your picks» (decision 2). almuteb.sa NXDOMAIN since '
                   || '2026-10-23 (8.8.8.8, 1.1.1.1; registry NS = DNS-PARKING.COM). 11 listings hidden and adjudicated '
                   || '(ops_adjudicated_retraction), rows kept. Un-retiring is an owner decision.')
   where platform = 'almuteb';
end
$retire$;

-- Registry reseed from sql/mirrors/liveness_registry.json (149 platforms). The only change vs the previous
-- seed (20261027113657): almuteb leaves the registry — it is retired (above), so no SLA is graded against
-- inventory nothing crawls. A full seed, because verify-liveness-registry-mirror.ts judges the LATEST seed.
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace) values
('aalbarrak','CANDIDATE_PLUS_DIRECT',168,3), ('abaad','DIRECT_REVISIT',48,3), ('abeea','CANDIDATE_PLUS_DIRECT',168,3), ('abralosol','SOURCE_LIST_PRESENCE',48,3), ('abwbna','SOURCE_LIST_PRESENCE',48,3), ('akariyoun','DIRECT_REVISIT',48,3), ('alajlan','SOURCE_LIST_PRESENCE',48,3), ('albdah','DIRECT_REVISIT',48,3), ('albukaeri','SOURCE_LIST_PRESENCE',48,3), ('aldarim','DIRECT_REVISIT',48,3), ('alhoshan','CANDIDATE_PLUS_DIRECT',168,3), ('alhumaidan','CRAWL_PRESENCE_ONLY',168,3), ('aljassim','DIRECT_REVISIT',48,3), ('alkhaas','SOURCE_LIST_PRESENCE',48,3), ('almotmkenah','DIRECT_REVISIT',48,3), ('alobid','SOURCE_LIST_PRESENCE',48,3), ('alqasem','CANDIDATE_PLUS_DIRECT',168,3), ('alrifai','CANDIDATE_PLUS_DIRECT',168,3), ('alsaedan','DIRECT_REVISIT',48,3), ('alshawaf','DIRECT_REVISIT',48,3), ('alsidra','CANDIDATE_PLUS_DIRECT',168,3), ('alta','CANDIDATE_PLUS_DIRECT',168,3), ('amaall','SOURCE_LIST_PRESENCE',48,3), ('amlakalahsa','SOURCE_LIST_PRESENCE',48,3), ('aouj','SOURCE_LIST_PRESENCE',48,3), ('aqalemhajer','DIRECT_REVISIT',48,3), ('aqar','DIRECT_REVISIT',48,3), ('aqaralriyadh','DIRECT_REVISIT',48,3), ('aqaralsaudia','CANDIDATE_PLUS_DIRECT',168,3), ('aqaratikom','SOURCE_LIST_PRESENCE',48,3), ('aqarcity','CANDIDATE_PLUS_DIRECT',168,3), ('aqargate','DIRECT_REVISIT',48,3), ('aqarmonthly','DIRECT_REVISIT',24,3), ('aqarnajran','SOURCE_LIST_PRESENCE',48,3), ('arkaan','SOURCE_LIST_PRESENCE',48,3), ('arsh','SOURCE_LIST_PRESENCE',48,3), ('ashab','SOURCE_LIST_PRESENCE',48,3), ('awal','SOURCE_LIST_PRESENCE',48,3), ('azdad','SOURCE_LIST_PRESENCE',48,3), ('azure','DIRECT_REVISIT',48,3), ('bahadhabab','SOURCE_LIST_PRESENCE',48,3), ('bossbih','DIRECT_REVISIT',48,3), ('compoundin','SOURCE_LIST_PRESENCE',48,3), ('dallali','SOURCE_LIST_PRESENCE',48,3), ('daraa','SOURCE_LIST_PRESENCE',48,3), ('daryusuf','DIRECT_REVISIT',48,3), ('dealapp','CANDIDATE_PLUS_DIRECT',48,3), ('dwelleo','DIRECT_REVISIT',48,3), ('eaqartabuk','DIRECT_REVISIT',48,3), ('earthapp','SOURCE_LIST_PRESENCE',48,3), ('eastabha','CANDIDATE_PLUS_DIRECT',168,3), ('ebriza','DIRECT_REVISIT',48,3), ('ego','DIRECT_REVISIT',48,3), ('eightfloor','SOURCE_LIST_PRESENCE',48,3), ('eilmalriyada','DIRECT_REVISIT',48,3), ('erapulse','SOURCE_LIST_PRESENCE',48,3), ('expattrusted','DIRECT_REVISIT',48,3), ('eydah','CANDIDATE_PLUS_DIRECT',168,3), ('fahadalshahri','SOURCE_LIST_PRESENCE',48,3), ('fkralemar','CANDIDATE_PLUS_DIRECT',168,3), ('flow','DIRECT_REVISIT',48,3), ('fursaghyr','SOURCE_LIST_PRESENCE',48,3), ('gathern','DIRECT_REVISIT',24,3), ('goldendeal','DIRECT_REVISIT',48,3), ('gomenassat','DIRECT_REVISIT',48,3), ('gudai','SOURCE_LIST_PRESENCE',48,3), ('hajer','DIRECT_REVISIT',48,3), ('haraj','DIRECT_REVISIT',48,3), ('hasaad','DIRECT_REVISIT',48,3), ('hazim','DIRECT_REVISIT',48,3), ('holoul','CANDIDATE_PLUS_DIRECT',168,3), ('ialqarawi','DIRECT_REVISIT',48,3), ('ibaax','DIRECT_REVISIT',48,3), ('jawher','CANDIDATE_PLUS_DIRECT',168,3), ('jazwtn','DIRECT_REVISIT',48,3), ('jurash','SOURCE_LIST_PRESENCE',48,3), ('justsa','DIRECT_REVISIT',48,3), ('ksaaqar','DIRECT_REVISIT',48,3), ('livingcompound','DIRECT_REVISIT',48,3), ('m3tmd','CANDIDATE_PLUS_DIRECT',168,3), ('macsaib','SOURCE_LIST_PRESENCE',48,3), ('manafe','SOURCE_LIST_PRESENCE',48,3), ('manzo','SOURCE_LIST_PRESENCE',48,3), ('maqam','DIRECT_REVISIT',48,3), ('maqrat','SOURCE_LIST_PRESENCE',48,3), ('marksa','DIRECT_REVISIT',48,3), ('masar','CANDIDATE_PLUS_DIRECT',168,3), ('mizlaj','CANDIDATE_PLUS_DIRECT',168,3), ('mobasher','SOURCE_LIST_PRESENCE',48,3), ('moftah','DIRECT_REVISIT',48,3), ('muajarh','SOURCE_LIST_PRESENCE',48,3), ('muhaysini','DIRECT_REVISIT',48,3), ('muktamel','CANDIDATE_PLUS_DIRECT',168,3), ('mustqr','DIRECT_REVISIT',48,3), ('nafithh','SOURCE_LIST_PRESENCE',48,3), ('nawafeth','SOURCE_LIST_PRESENCE',48,3), ('nofodh','DIRECT_REVISIT',48,3), ('nowaisiry','CANDIDATE_PLUS_DIRECT',168,3), ('nufouth','DIRECT_REVISIT',48,3), ('october','SOURCE_LIST_PRESENCE',48,3), ('opensooq','SOURCE_LIST_PRESENCE',48,3), ('qmra','DIRECT_REVISIT',48,3), ('raghdan','DIRECT_REVISIT',48,3), ('rakez','DIRECT_REVISIT',48,3), ('ramzalqasim','SOURCE_LIST_PRESENCE',48,3), ('rawaf','SOURCE_LIST_PRESENCE',48,3), ('rawasidark','SOURCE_LIST_PRESENCE',48,3), ('razre','DIRECT_REVISIT',48,3), ('reinvest','DIRECT_REVISIT',48,3), ('remal','SOURCE_LIST_PRESENCE',48,3), ('remaxsa','DIRECT_REVISIT',48,3), ('rightcompound','DIRECT_REVISIT',48,3), ('ryadah','SOURCE_LIST_PRESENCE',48,3), ('sadin','CRAWL_PRESENCE_ONLY',168,3), ('sadiqeltajer','DIRECT_REVISIT',48,3), ('safa','DIRECT_REVISIT',48,3), ('safera','SOURCE_LIST_PRESENCE',48,3), ('sakan','CANDIDATE_PLUS_DIRECT',168,1), ('sakani','CANDIDATE_PLUS_DIRECT',168,3), ('sanadak','CANDIDATE_PLUS_DIRECT',168,3), ('satel','SOURCE_LIST_PRESENCE',48,3), ('senan','CANDIDATE_PLUS_DIRECT',168,3), ('shatri','DIRECT_REVISIT',48,3), ('shmoualshmal','SOURCE_LIST_PRESENCE',48,3), ('sirdab','SOURCE_LIST_PRESENCE',48,3), ('snam','DIRECT_REVISIT',48,3), ('sodasyat','DIRECT_REVISIT',48,3), ('sokok','DIRECT_REVISIT',48,3), ('souq24','DIRECT_REVISIT',48,3), ('sqcc','CANDIDATE_PLUS_DIRECT',168,3), ('squares','SOURCE_LIST_PRESENCE',48,3), ('sukna','DIRECT_REVISIT',48,3), ('superoffice','SOURCE_LIST_PRESENCE',48,3), ('shomou','SOURCE_LIST_PRESENCE',48,3), ('maktab','SOURCE_LIST_PRESENCE',48,3), ('suwar','DIRECT_REVISIT',48,3), ('tamyaz','DIRECT_REVISIT',48,3), ('tawia','SOURCE_LIST_PRESENCE',48,3), ('therc','CANDIDATE_PLUS_DIRECT',168,3), ('thousand','CANDIDATE_PLUS_DIRECT',168,3), ('tuba','DIRECT_REVISIT',48,3), ('villassa','DIRECT_REVISIT',48,3), ('vmksa','SOURCE_LIST_PRESENCE',48,3), ('wadod','DIRECT_REVISIT',48,3), ('wahadat','SOURCE_LIST_PRESENCE',48,3), ('wajaf','SOURCE_LIST_PRESENCE',48,3), ('wasalt','DIRECT_REVISIT',48,3), ('wslnaa','SOURCE_LIST_PRESENCE',48,3), ('yameen','DIRECT_REVISIT',48,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;
delete from public.ops_liveness_registry
where platform not in ('aalbarrak','abaad','abeea','abralosol','abwbna','akariyoun','alajlan','albdah','albukaeri','aldarim','alhoshan','alhumaidan','aljassim','alkhaas','almotmkenah','alobid','alqasem','alrifai','alsaedan','alshawaf','alsidra','alta','amaall','amlakalahsa','aouj','aqalemhajer','aqar','aqaralriyadh','aqaralsaudia','aqaratikom','aqarcity','aqargate','aqarmonthly','aqarnajran','arkaan','arsh','ashab','awal','azdad','azure','bahadhabab','bossbih','compoundin','dallali','daraa','daryusuf','dealapp','dwelleo','eaqartabuk','earthapp','eastabha','ebriza','ego','eightfloor','eilmalriyada','erapulse','expattrusted','eydah','fahadalshahri','fkralemar','flow','fursaghyr','gathern','goldendeal','gomenassat','gudai','hajer','haraj','hasaad','hazim','holoul','ialqarawi','ibaax','jawher','jazwtn','jurash','justsa','ksaaqar','livingcompound','m3tmd','macsaib','manafe','manzo','maqam','maqrat','marksa','masar','mizlaj','mobasher','moftah','muajarh','muhaysini','muktamel','mustqr','nafithh','nawafeth','nofodh','nowaisiry','nufouth','october','opensooq','qmra','raghdan','rakez','ramzalqasim','rawaf','rawasidark','razre','reinvest','remal','remaxsa','rightcompound','ryadah','sadin','sadiqeltajer','safa','safera','sakan','sakani','sanadak','satel','senan','shatri','shmoualshmal','sirdab','snam','sodasyat','sokok','souq24','sqcc','squares','sukna','superoffice','shomou','maktab','suwar','tamyaz','tawia','therc','thousand','tuba','villassa','vmksa','wadod','wahadat','wajaf','wasalt','wslnaa','yameen');
