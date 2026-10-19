-- سوار joins the liveness registry — a FULL RESEED, replacing 20260914071345's insert-only version.
-- verify-liveness-registry-mirror.ts requires the LATEST registry-seed migration to be the complete
-- registry plus a delete clause: an insert-only seed cannot retire a platform, so the dashboard
-- would keep reporting coverage for inventory nothing verifies any more. The earlier migration in
-- this same change got that wrong and the barrier caught it before merge.
--
-- سوار is CRAWL_PRESENCE_ONLY, the same tier as every sibling WordPress office catalogue: the full
-- feed is re-read each run, so absence only SELECTS candidates, and scrapers/suwar/run.py::
-- _verify_gone gives each at-grace row a direct confirm before prune_unseen may deactivate it.
-- Control-validated live 2026-09-14 — it HARD-DELETES rather than flipping a status: id 22413
-- (live) → HTTP 200 status=publish; id 22400 (absent from the feed) and never-existing id 999999
-- → HTTP 404 rest_post_invalid_id.
insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace) values
  ('abeea','CRAWL_PRESENCE_ONLY',168,3),
  ('abralosol','CRAWL_PRESENCE_ONLY',168,3),
  ('abwbna','CRAWL_PRESENCE_ONLY',168,3),
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
  ('mizlaj','CRAWL_PRESENCE_ONLY',168,3),
  ('muktamel','CRAWL_PRESENCE_ONLY',168,3),
  ('mustqr','CRAWL_PRESENCE_ONLY',168,3),
  ('nowaisiry','CRAWL_PRESENCE_ONLY',168,3),
  ('october','CRAWL_PRESENCE_ONLY',168,3),
  ('raghdan','CRAWL_PRESENCE_ONLY',168,3),
  ('ramzalqasim','CRAWL_PRESENCE_ONLY',168,3),
  ('rawasidark','CRAWL_PRESENCE_ONLY',168,3),
  ('remal','CRAWL_PRESENCE_ONLY',168,3),
  ('sadin','CRAWL_PRESENCE_ONLY',168,3),
  ('sanadak','CRAWL_PRESENCE_ONLY',168,3),
  ('satel','CRAWL_PRESENCE_ONLY',168,3),
  ('shmoualshmal','CRAWL_PRESENCE_ONLY',168,3),
  ('souq24','CRAWL_PRESENCE_ONLY',168,3),
  ('suwar','CRAWL_PRESENCE_ONLY',168,3),
  ('therc','CRAWL_PRESENCE_ONLY',168,3),
  ('wasalt','DIRECT_REVISIT',96,3)
on conflict (platform) do update set strategy = excluded.strategy,
  sla_hours = excluded.sla_hours, grace = excluded.grace;

delete from public.ops_liveness_registry
where platform not in ('abeea','abralosol','abwbna','aldarim','alhoshan','alkhaas','alobid','alta','amaall','amlakalahsa','aouj','aqar','aqaralsaudia','aqaratikom','aqarcity','aqargate','aqarmonthly','arkaan','awal','azdad','bahadhabab','dealapp','eaqartabuk','eastabha','erapulse','fursaghyr','gathern','hajer','jazwtn','jurash','mizlaj','muktamel','mustqr','nowaisiry','october','raghdan','ramzalqasim','rawasidark','remal','sadin','sanadak','satel','shmoualshmal','souq24','suwar','therc','wasalt');

do $$
declare v_gap text[];
begin
  select coalesce(array_agg(distinct split_part(s.source_table,'_',1)), '{}') into v_gap
    from public.search_listings_ar s
   where s.production_ready
     and not exists (select 1 from public.ops_liveness_registry r
                      where r.platform = split_part(s.source_table,'_',1));
  if cardinality(v_gap) > 0 then
    raise exception 'searchable but unregistered: %', v_gap;
  end if;
end $$;