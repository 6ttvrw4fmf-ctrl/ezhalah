-- muktamel was PAUSED, not un-searchable — and the exemption that said so silenced its liveness.
--
-- WHAT HAPPENED. muktamel went into liveness_policies.NOT_PRODUCTION_SEARCHABLE on 2026-07-15 when it
-- was "paused": moved off the shared cron matrix onto its own gated weekly workflow
-- (muktamel-sync.yml). That is a CADENCE fact. Its two tables never left the client's
-- RES_TABLES/COM_TABLES, and on 2026-09-03 a gated run put 523 production_ready rows into
-- search_listings_ar. Measured 2026-09-04: 524 active raw rows, 523 searchable, 0 EVER verified
-- alive, and 4 commercial rows already accruing strikes under no grace contract — on a platform
-- policy_for() would raise KeyError for. It is also the subject of an open proxy_block_spike P1
-- (27 blocked runs in 24h), and "blocked never inactivates" is exactly the guarantee a policy
-- carries and an unregistered platform does not.
--
-- WHY NOTHING CAUGHT IT. verify-liveness-contract.ts compares the scrapers/ DIRECTORY LISTING against
-- POLICIES + NOT_PRODUCTION_SEARCHABLE. An entry in that set is a CLAIM ABOUT PRODUCTION, and no
-- offline check can verify it. So the claim went stale silently and CI stayed green for a day.
--
-- THE POLICY. CRAWL_PRESENCE_ONLY / grace 3 / SLA 168h — identical to all 30 peer small platforms,
-- and the SAFEST tier available: absence_is_candidate_only (a missed crawl can never kill a row) and
-- presence_is_positive_evidence=False (being seen never stamps verified-alive). Given the open proxy
-- blocks, the conservative tier is also the correct one; 168h matches its weekly cadence.
--
-- Re-seeds the WHOLE registry from sql/mirrors/liveness_registry.json (35 platforms) rather than
-- inserting one row, because verify-liveness-registry-mirror.ts holds the LATEST seed migration to
-- exact equality with the JSON mirror, and the retention delete must match it too.
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
  ('muktamel','CRAWL_PRESENCE_ONLY',168,3),
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
on conflict (platform) do update set strategy = excluded.strategy,
  sla_hours = excluded.sla_hours, grace = excluded.grace;

delete from public.ops_liveness_registry
where platform not in ('abeea','abralosol','aldarim','alhoshan','alkhaas','aouj','aqar','aqaratikom','aqarcity','aqargate','aqarmonthly','arkaan','dealapp','eaqartabuk','eastabha','erapulse','fursaghyr','gathern','hajer','jazwtn','jurash','mizlaj','muktamel','mustqr','nowaisiry','october','raghdan','ramzalqasim','rawasidark','sadin','sanadak','satel','souq24','therc','wasalt');

-- Fail closed: every platform contributing searchable listings must now be registered.
do $$
declare v_gap text[];
begin
  select coalesce(array_agg(distinct split_part(s.source_table,'_',1)), '{}') into v_gap
    from public.search_listings_ar s
   where s.production_ready
     and not exists (select 1 from public.ops_liveness_registry r
                      where r.platform = split_part(s.source_table,'_',1));
  if cardinality(v_gap) > 0 then
    raise exception 'platforms searchable but unregistered after this seed: %', v_gap;
  end if;
end $$;
