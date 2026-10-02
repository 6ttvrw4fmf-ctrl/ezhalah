-- SOURCE_LIST_PRESENCE: a fourth liveness tier. Owner, 2026-10-02: «yes do that for all 60 sites …
-- check them every single day» — the rule wasalt already has («its own search list is the check»),
-- for small sites with no per-listing checker: the crawl re-reads the site's own complete list every
-- day, and a row that list serves is stamped verified-alive (liveness_contract.presence_patch,
-- through db._wasalt_batch), 48 h window. It changes what counts as verified, never what counts as
-- dead: grace stays 3 and the death side is untouched.
--
-- 33 sites are admitted, by name (liveness_policies.SOURCE_LIST_DAILY). On 2026-10-02 every
-- crawler was read twice (an auditor, then a second reader told to break the verdict) and a site is
-- admitted only where both found that a row cannot be upserted active unless that run observed it
-- at the source and that the crawler excludes every unavailable state the source publishes. The
-- same day 488 in-list ads were opened at their own URL from a second network; none answered gone.
-- The other CRAWL_PRESENCE_ONLY sites stay where they are, each with its reason in
-- scrapers/lifecycle-gaps.txt.
--
-- Why a tier and not a flag: scripts/verify-liveness-claims-are-earned.ts reads production and
-- treats any stamp on a CRAWL_PRESENCE_ONLY platform as a forgery, and calling these sites
-- DIRECT_REVISIT would claim a page read that does not exist.
--
-- 1. the strategy CHECK accepts the tier; the registry is reseeded from
--    sql/mirrors/liveness_registry.json in one pass, 149 platforms, with the delete clause.
-- 2. mon_detect_liveness_verification_sla grades the tier (P1 under 50% inside its 48 h window),
--    from 2026-10-03 06:00 UTC, after the first crawl that stamps it: this is what makes the tier a
--    checked promise, and its stall alarm.
-- 3. ops_liveness_checking_shortfall skips the tier: it counts per-row probes, which a list read
--    never writes, so it would report every admitted site as "never checked".
-- 4. mon_detect_served_after_source_confirmed_gone names the tier's evidence honestly instead of
--    reading list stamps as a working direct oracle.
-- 5. ops_platform_protection_matrix says what checks the site instead of "crawl presence only".
alter table public.ops_liveness_registry drop constraint ops_liveness_registry_strategy_check;
alter table public.ops_liveness_registry add constraint ops_liveness_registry_strategy_check
  check (strategy in ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT','SOURCE_LIST_PRESENCE','CRAWL_PRESENCE_ONLY'));

insert into public.ops_liveness_registry (platform, strategy, sla_hours, grace) values
('aalbarrak','CANDIDATE_PLUS_DIRECT',168,3), ('abaad','DIRECT_REVISIT',48,3), ('abeea','CANDIDATE_PLUS_DIRECT',168,3), ('abralosol','CRAWL_PRESENCE_ONLY',168,3), ('abwbna','SOURCE_LIST_PRESENCE',48,3), ('akariyoun','DIRECT_REVISIT',48,3), ('alajlan','SOURCE_LIST_PRESENCE',48,3), ('albdah','DIRECT_REVISIT',48,3), ('albukaeri','CRAWL_PRESENCE_ONLY',168,3), ('aldarim','DIRECT_REVISIT',48,3), ('alhoshan','CRAWL_PRESENCE_ONLY',168,3), ('alhumaidan','CRAWL_PRESENCE_ONLY',168,3), ('aljassim','DIRECT_REVISIT',48,3), ('alkhaas','SOURCE_LIST_PRESENCE',48,3), ('almotmkenah','DIRECT_REVISIT',48,3), ('almuteb','CANDIDATE_PLUS_DIRECT',168,3), ('alobid','SOURCE_LIST_PRESENCE',48,3), ('alqasem','CANDIDATE_PLUS_DIRECT',168,3), ('alrifai','CANDIDATE_PLUS_DIRECT',168,3), ('alsaedan','DIRECT_REVISIT',48,3), ('alshawaf','DIRECT_REVISIT',48,3), ('alsidra','CANDIDATE_PLUS_DIRECT',168,3), ('alta','CRAWL_PRESENCE_ONLY',168,3), ('amaall','SOURCE_LIST_PRESENCE',48,3), ('amlakalahsa','SOURCE_LIST_PRESENCE',48,3), ('aouj','SOURCE_LIST_PRESENCE',48,3), ('aqalemhajer','CANDIDATE_PLUS_DIRECT',168,3), ('aqar','DIRECT_REVISIT',48,3), ('aqaralriyadh','DIRECT_REVISIT',48,3), ('aqaralsaudia','CANDIDATE_PLUS_DIRECT',168,3), ('aqaratikom','CRAWL_PRESENCE_ONLY',168,3), ('aqarcity','CANDIDATE_PLUS_DIRECT',168,3), ('aqargate','DIRECT_REVISIT',48,3), ('aqarmonthly','DIRECT_REVISIT',48,3), ('aqarnajran','CRAWL_PRESENCE_ONLY',168,3), ('arkaan','CRAWL_PRESENCE_ONLY',168,3), ('arsh','SOURCE_LIST_PRESENCE',48,3), ('ashab','SOURCE_LIST_PRESENCE',48,3), ('awal','CRAWL_PRESENCE_ONLY',168,3), ('azdad','SOURCE_LIST_PRESENCE',48,3), ('azure','DIRECT_REVISIT',48,3), ('bahadhabab','SOURCE_LIST_PRESENCE',48,3), ('bossbih','DIRECT_REVISIT',48,3), ('compoundin','SOURCE_LIST_PRESENCE',48,3), ('dallali','CRAWL_PRESENCE_ONLY',168,3), ('daraa','SOURCE_LIST_PRESENCE',48,3), ('daryusuf','DIRECT_REVISIT',48,3), ('dealapp','CANDIDATE_PLUS_DIRECT',96,3), ('dwelleo','DIRECT_REVISIT',48,3), ('eaqartabuk','DIRECT_REVISIT',48,3), ('earthapp','SOURCE_LIST_PRESENCE',48,3), ('eastabha','CANDIDATE_PLUS_DIRECT',168,3), ('ebriza','DIRECT_REVISIT',48,3), ('ego','DIRECT_REVISIT',48,3), ('eightfloor','SOURCE_LIST_PRESENCE',48,3), ('eilmalriyada','DIRECT_REVISIT',48,3), ('erapulse','SOURCE_LIST_PRESENCE',48,3), ('expattrusted','DIRECT_REVISIT',48,3), ('eydah','CANDIDATE_PLUS_DIRECT',168,3), ('fahadalshahri','CRAWL_PRESENCE_ONLY',168,3), ('fkralemar','CANDIDATE_PLUS_DIRECT',168,3), ('flow','DIRECT_REVISIT',48,3), ('fursaghyr','CRAWL_PRESENCE_ONLY',168,3), ('gathern','DIRECT_REVISIT',96,3), ('goldendeal','CANDIDATE_PLUS_DIRECT',168,3), ('gomenassat','DIRECT_REVISIT',48,3), ('gudai','SOURCE_LIST_PRESENCE',48,3), ('hajer','DIRECT_REVISIT',48,3), ('hasaad','DIRECT_REVISIT',48,3), ('hazim','DIRECT_REVISIT',48,3), ('holoul','CRAWL_PRESENCE_ONLY',168,3), ('ialqarawi','DIRECT_REVISIT',48,3), ('ibaax','DIRECT_REVISIT',48,3), ('jawher','CANDIDATE_PLUS_DIRECT',168,3), ('jazwtn','DIRECT_REVISIT',48,3), ('jurash','SOURCE_LIST_PRESENCE',48,3), ('justsa','DIRECT_REVISIT',48,3), ('ksaaqar','CRAWL_PRESENCE_ONLY',168,3), ('livingcompound','DIRECT_REVISIT',48,3), ('m3tmd','CANDIDATE_PLUS_DIRECT',168,3), ('macsaib','SOURCE_LIST_PRESENCE',48,3), ('manafe','SOURCE_LIST_PRESENCE',48,3), ('manzo','SOURCE_LIST_PRESENCE',48,3), ('maqam','CANDIDATE_PLUS_DIRECT',168,3), ('maqrat','CRAWL_PRESENCE_ONLY',168,3), ('marksa','DIRECT_REVISIT',48,3), ('masar','CANDIDATE_PLUS_DIRECT',168,3), ('mizlaj','CANDIDATE_PLUS_DIRECT',168,3), ('mobasher','SOURCE_LIST_PRESENCE',48,3), ('moftah','DIRECT_REVISIT',48,3), ('muajarh','CRAWL_PRESENCE_ONLY',168,3), ('muhaysini','DIRECT_REVISIT',48,3), ('muktamel','CANDIDATE_PLUS_DIRECT',168,3), ('mustqr','CANDIDATE_PLUS_DIRECT',168,3), ('nafithh','CRAWL_PRESENCE_ONLY',168,3), ('nawafeth','SOURCE_LIST_PRESENCE',48,3), ('nofodh','DIRECT_REVISIT',48,3), ('nowaisiry','CANDIDATE_PLUS_DIRECT',168,3), ('nufouth','DIRECT_REVISIT',48,3), ('october','CRAWL_PRESENCE_ONLY',168,3), ('opensooq','CRAWL_PRESENCE_ONLY',168,3), ('qmra','DIRECT_REVISIT',48,3), ('raghdan','DIRECT_REVISIT',48,3), ('rakez','CANDIDATE_PLUS_DIRECT',168,3), ('ramzalqasim','CRAWL_PRESENCE_ONLY',168,3), ('rawaf','SOURCE_LIST_PRESENCE',48,3), ('rawasidark','SOURCE_LIST_PRESENCE',48,3), ('razre','DIRECT_REVISIT',48,3), ('reinvest','DIRECT_REVISIT',48,3), ('remal','SOURCE_LIST_PRESENCE',48,3), ('remaxsa','DIRECT_REVISIT',48,3), ('rightcompound','DIRECT_REVISIT',48,3), ('ryadah','SOURCE_LIST_PRESENCE',48,3), ('sadin','CRAWL_PRESENCE_ONLY',168,3), ('sadiqeltajer','CRAWL_PRESENCE_ONLY',168,3), ('safa','DIRECT_REVISIT',48,3), ('safera','CRAWL_PRESENCE_ONLY',168,3), ('sakan','CANDIDATE_PLUS_DIRECT',168,3), ('sakani','CANDIDATE_PLUS_DIRECT',168,3), ('sanadak','CANDIDATE_PLUS_DIRECT',168,3), ('satel','CRAWL_PRESENCE_ONLY',168,3), ('senan','CANDIDATE_PLUS_DIRECT',168,3), ('shatri','CANDIDATE_PLUS_DIRECT',168,3), ('shmoualshmal','CRAWL_PRESENCE_ONLY',168,3), ('sirdab','SOURCE_LIST_PRESENCE',48,3), ('snam','DIRECT_REVISIT',48,3), ('sodasyat','DIRECT_REVISIT',48,3), ('sokok','DIRECT_REVISIT',48,3), ('souq24','DIRECT_REVISIT',48,3), ('sqcc','CRAWL_PRESENCE_ONLY',168,3), ('squares','CRAWL_PRESENCE_ONLY',168,3), ('sukna','DIRECT_REVISIT',48,3), ('superoffice','SOURCE_LIST_PRESENCE',48,3), ('shomou','CRAWL_PRESENCE_ONLY',168,3), ('maktab','SOURCE_LIST_PRESENCE',48,3), ('suwar','DIRECT_REVISIT',48,3), ('tamyaz','DIRECT_REVISIT',48,3), ('tawia','SOURCE_LIST_PRESENCE',48,3), ('therc','CRAWL_PRESENCE_ONLY',168,3), ('thousand','CANDIDATE_PLUS_DIRECT',168,3), ('tuba','DIRECT_REVISIT',48,3), ('villassa','DIRECT_REVISIT',48,3), ('vmksa','CRAWL_PRESENCE_ONLY',168,3), ('wadod','DIRECT_REVISIT',48,3), ('wahadat','CRAWL_PRESENCE_ONLY',168,3), ('wajaf','SOURCE_LIST_PRESENCE',48,3), ('wasalt','DIRECT_REVISIT',96,3), ('wslnaa','SOURCE_LIST_PRESENCE',48,3), ('yameen','CANDIDATE_PLUS_DIRECT',168,3)
on conflict (platform) do update
  set strategy = excluded.strategy, sla_hours = excluded.sla_hours, grace = excluded.grace;

delete from public.ops_liveness_registry
where platform not in ('aalbarrak','abaad','abeea','abralosol','abwbna','akariyoun','alajlan','albdah','albukaeri','aldarim','alhoshan','alhumaidan','aljassim','alkhaas','almotmkenah','almuteb','alobid','alqasem','alrifai','alsaedan','alshawaf','alsidra','alta','amaall','amlakalahsa','aouj','aqalemhajer','aqar','aqaralriyadh','aqaralsaudia','aqaratikom','aqarcity','aqargate','aqarmonthly','aqarnajran','arkaan','arsh','ashab','awal','azdad','azure','bahadhabab','bossbih','compoundin','dallali','daraa','daryusuf','dealapp','dwelleo','eaqartabuk','earthapp','eastabha','ebriza','ego','eightfloor','eilmalriyada','erapulse','expattrusted','eydah','fahadalshahri','fkralemar','flow','fursaghyr','gathern','goldendeal','gomenassat','gudai','hajer','hasaad','hazim','holoul','ialqarawi','ibaax','jawher','jazwtn','jurash','justsa','ksaaqar','livingcompound','m3tmd','macsaib','manafe','manzo','maqam','maqrat','marksa','masar','mizlaj','mobasher','moftah','muajarh','muhaysini','muktamel','mustqr','nafithh','nawafeth','nofodh','nowaisiry','nufouth','october','opensooq','qmra','raghdan','rakez','ramzalqasim','rawaf','rawasidark','razre','reinvest','remal','remaxsa','rightcompound','ryadah','sadin','sadiqeltajer','safa','safera','sakan','sakani','sanadak','satel','senan','shatri','shmoualshmal','sirdab','snam','sodasyat','sokok','souq24','sqcc','squares','sukna','superoffice','shomou','maktab','suwar','tamyaz','tawia','therc','thousand','tuba','villassa','vmksa','wadod','wahadat','wajaf','wasalt','wslnaa','yameen');

create or replace function public.mon_detect_liveness_verification_sla()
returns int
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  -- A grace DATE, not a grace period counted from "now": a fixed date cannot be reset by a
  -- redeploy, and it is visible in the function body rather than buried in a config row.
  v_active_from date := date '2026-09-13';
  v_floor numeric := 50.0;
  -- SOURCE_LIST_PRESENCE is graded from the first daily crawl after the tier landed (04:22 UTC on
  -- 2026-10-03 stamps it): until then every admitted site reads 0% by construction.
  v_list_tier_from timestamptz := timestamptz '2026-10-03 06:00:00+00';
  v_raised int := 0;
  r record;
begin
  if current_date < v_active_from then
    return 0;   -- verification is still populating; alerting now would only produce noise
  end if;

  for r in
    select platform, strategy, active, verified_in_sla, never_verified, pct_verified_in_sla
      from public.ops_platform_liveness_coverage
     where (strategy in ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT')
            or (strategy = 'SOURCE_LIST_PRESENCE' and now() >= v_list_tier_from))
       and active > 0
  loop
    if coalesce(r.pct_verified_in_sla, 0) < v_floor then
      perform public.mon_raise('P1', 'liveness_verification_sla', r.platform,
        'liveness_sla:' || r.platform,
        jsonb_build_object(
          'platform', r.platform,
          'strategy', r.strategy,
          'active', r.active,
          'verified_in_sla', r.verified_in_sla,
          'never_verified', r.never_verified,
          'pct_verified_in_sla', r.pct_verified_in_sla,
          'floor_pct', v_floor,
          'why', 'active=true is supposed to mean we have recent affirmative evidence this '
              || 'listing is live. On this platform most active rows carry no such evidence '
              || 'inside its own SLA window, so its VERIFICATION SYSTEM is unhealthy -- this is '
              || 'not a statement about its inventory. Do NOT deactivate anything in response: '
              || 'absence of verification is UNKNOWN, never death (owner rule 2026-08-30).',
          'action', 'find why that platform liveness job is not covering its population: not '
              || 'scheduled, quarantined by a trust gate, blocked proxy, or a probe rate too low '
              || 'for the population size.'));
      v_raised := v_raised + 1;
    else
      perform public.mon_resolve_key('liveness_verification_sla', 'liveness_sla:' || r.platform);
    end if;
  end loop;

  return v_raised;
end $fn$;

create or replace function public.ops_liveness_checking_shortfall(p_inject jsonb default '[]'::jsonb)
returns table(
  platform text, active_rows bigint, sla_hours int, probes_24h bigint, probes_7d bigint,
  required_per_day bigint, pct_of_required numeric, shape text, injected boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  r record;
  v_active bigint;
  v_24h    bigint;
  v_7d     bigint;
  v_sla    int;
  v_req    bigint;
  v_pct    numeric;
  v_shape  text;
begin
  -- Injected rows first, so the detector can self-test its own predicate without touching data.
  return query
    select x->>'platform',
           coalesce((x->>'active_rows')::bigint, 0),
           coalesce((x->>'sla_hours')::int, 168),
           coalesce((x->>'probes_24h')::bigint, 0),
           coalesce((x->>'probes_7d')::bigint, 0),
           coalesce((x->>'required_per_day')::bigint, 0),
           coalesce((x->>'pct_of_required')::numeric, 0),
           x->>'shape',
           true
      from jsonb_array_elements(coalesce(p_inject, '[]'::jsonb)) x
     where x->>'platform' is not null;

  for r in
    select regexp_replace(tablename, '_(residential|commercial)_listings$', '') as plat,
           array_agg(tablename order by tablename) as tbls
      from pg_tables
     where schemaname = 'public' and tablename ~ '_(residential|commercial)_listings$'
       and exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = pg_tables.tablename
                      and c.column_name = 'last_liveness_probe_at')
     group by 1
  loop
    -- SOURCE_LIST_PRESENCE: the daily crawl of the site's own complete list IS the check (owner
    -- 2026-10-02). It stamps last_verified_alive_at, never last_liveness_probe_at, and is graded on
    -- its own 48 h window by mon_detect_liveness_verification_sla, not on a per-row probe rate.
    continue when exists (select 1 from public.ops_liveness_registry p
                           where p.platform = r.plat and p.strategy = 'SOURCE_LIST_PRESENCE');
    v_active := 0; v_24h := 0; v_7d := 0;
    declare t text; a bigint; b bigint; c2 bigint;
    begin
      foreach t in array r.tbls loop
        execute format(
          'select count(*) filter (where active),
                  count(*) filter (where active and last_liveness_probe_at > now() - interval ''24 hours''),
                  count(*) filter (where active and last_liveness_probe_at > now() - interval ''7 days'')
             from public.%I', t)
          into a, b, c2;
        v_active := v_active + coalesce(a, 0);
        v_24h    := v_24h + coalesce(b, 0);
        v_7d     := v_7d + coalesce(c2, 0);
      end loop;
    end;

    continue when v_active = 0;   -- nothing served, nothing owed

    select coalesce(max(p.sla_hours), 168) into v_sla
      from public.ops_liveness_registry p where p.platform = r.plat;
    if v_sla is null or v_sla <= 0 then v_sla := 168; end if;

    -- rows/day needed for a full pass to finish inside the platform's OWN declared SLA
    v_req := ceil(v_active / (v_sla / 24.0))::bigint;
    v_pct := round(100.0 * v_24h / nullif(v_req, 0), 1);

    v_shape := case
      when v_7d = 0  then 'NEVER_CHECKED'                -- nothing has looked at this platform at all
      when v_24h = 0 then 'STALLED'                      -- it was running and stopped
      when v_24h < v_req * 0.5 then 'BEHIND'             -- running at under half the needed rate
      else null
    end;

    continue when v_shape is null;

    platform := r.plat; active_rows := v_active; sla_hours := v_sla;
    probes_24h := v_24h; probes_7d := v_7d; required_per_day := v_req;
    pct_of_required := coalesce(v_pct, 0); shape := v_shape; injected := false;
    return next;
  end loop;
end
$fn$;

create or replace function public.mon_detect_served_after_source_confirmed_gone()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  r record;
  seen text[] := array[]::text[];
begin
  for r in select * from public.mon_served_after_source_gone order by still_served desc loop
    seen := seen || r.source_table;

    if r.strategy = 'SOURCE_LIST_PRESENCE' then
      -- This platform's stamps come from its own list, not from a page read, so neither existing
      -- class describes it: there is no direct oracle that "works", and it is not unverified.
      n := n + public.mon_raise(
        case when r.still_served > 0 then 'P1' else 'P2' end,
        'served_after_source_gone', r.platform,
        'served_after_source_gone:' || r.source_table,
        jsonb_build_object(
          'source_table', r.source_table,
          'evidence_class', 'SOURCE_LIST_PRESENCE',
          'strategy', r.strategy,
          'struck_active', r.struck_active,
          'still_served', r.still_served,
          'list_presence_stamps', r.oracle_verifications,
          'why', 'These rows missed the site''s own complete list on 3+ crawls and are still active. '
                 'This platform has NO per-listing page check: its verification stamps come from '
                 'list presence (owner rule 2026-10-02), so they are not direct reads. Find why the '
                 'crawl''s own prune did not act; do not loosen a cap to clear it.'));
      continue;
    end if;

    if r.oracle_has_ever_worked then
      -- A working direct oracle exists for this platform, so a full-grace strike is real evidence
      -- and a stuck deletion path is the likely cause. Unchanged from the original contract.
      n := n + public.mon_raise(
        case when r.still_served > 0 then 'P1' else 'P2' end,
        'served_after_source_gone', r.platform,
        'served_after_source_gone:' || r.source_table,
        jsonb_build_object(
          'source_table', r.source_table,
          'evidence_class', 'DIRECT_VERIFICATION_AVAILABLE',
          'strategy', r.strategy,
          'struck_active', r.struck_active,
          'still_served', r.still_served,
          'struck_direct_verified', r.struck_direct_verified,
          'oracle_verifications', r.oracle_verifications,
          'why', 'These rows carry the FULL strike grace and have not been seen for 3+ days, yet '
                 'they are still active and ' || r.still_served || ' of them are production_ready '
                 '— real users can find and click a listing the source may no longer serve. This '
                 'platform''s direct oracle DOES work (' || r.oracle_verifications || ' rows carry '
                 'a real verification), so a stuck deletion path is the likely cause: a liveness '
                 'kill-cap/anomaly gate refusing the batch, a prune circuit breaker, or a disabled '
                 'cleanup policy. DIAGNOSE THAT — do NOT loosen the cap to clear the backlog. '
                 'Actioning a batch this size is a bulk listing operation and an owner decision '
                 '(AGENTS.md RED list); the guard refusing it is working as designed. Confirm each '
                 'row against the source before it is actioned: only the ' ||
                 r.struck_direct_verified || ' struck_direct_verified rows have ever been reached '
                 'directly.'));
    else
      -- NO oracle has ever succeeded here. Every strike is crawl absence, which
      -- docs/ops/LISTING_LIVENESS.md rules is a candidate signal and NEVER a verdict. The backlog
      -- is UNKNOWN, not dead, and the remedy is upstream: make the oracle work.
      n := n + public.mon_raise(
        'P1',
        'served_after_source_gone', r.platform,
        'served_after_source_gone:' || r.source_table,
        jsonb_build_object(
          'source_table', r.source_table,
          'evidence_class', 'NO_DIRECT_VERIFICATION_EVER',
          'strategy', r.strategy,
          'struck_active', r.struck_active,
          'still_served', r.still_served,
          'struck_direct_verified', r.struck_direct_verified,
          'oracle_verifications', 0,
          'why', 'READ THIS BEFORE ACTIONING ANYTHING. ' || r.struck_active || ' rows carry the '
                 'full strike grace, but NOT ONE row in this table has ever been verified alive by '
                 'a direct fetch (last_verified_alive_at is null everywhere). The declared strategy '
                 'is ' || coalesce(r.strategy, 'UNREGISTERED') || ', so these strikes came from '
                 'CRAWL ABSENCE alone — which LISTING_LIVENESS rules is a candidate signal and '
                 'NEVER a verdict. These rows are UNKNOWN, not gone, and inactivating them would '
                 'be a mass FALSE inactivation. A deletion_spike/anomaly gate aborting on this '
                 'backlog is CORRECT: do NOT raise anomaly_floor and do NOT force a drain. The '
                 'real defect is upstream — the direct oracle for this platform has never once '
                 'succeeded. Fix that (for wasalt: WASALT_PROXY_URL; a datacenter IP returns HTTP '
                 '403, which is UNKNOWN and must never be read as death), then re-assess.'));
    end if;
  end loop;

  perform public.mon_resolve_key('served_after_source_gone', 'served_after_source_gone:' || t.relname)
    from pg_class t join pg_namespace ns on ns.oid = t.relnamespace
   where ns.nspname = 'public' and t.relkind = 'r'
     and t.relname ~ '_(residential|commercial)_listings$'
     and not (t.relname = any(seen));

  return n;
end $function$;

create or replace function public.ops_platform_protection_matrix()
 returns table(platform text, active bigint, liveness_strategy text, direct_liveness_check boolean, production_verified boolean, pct_verified_in_sla numeric, location_protections boolean, district_source_check boolean, served bigint, native_resolved bigint, pct_with_city numeric, source_district_rows bigint, remaining_issue text, final_status text)
 language sql
 stable
 set statement_timeout to '180s'
as $function$
  with inv as (
    select c.platform, c.active, c.strategy, c.pct_verified_in_sla
      from public.ops_platform_liveness_coverage c where c.active > 0),
  s as (select s.platform, count(*) n, count(*) filter (where s.city_id is not null) with_city
          from public.search_listings_ar s group by 1),
  st as (select distinct s.platform, s.source_table from public.search_listings_ar s),
  v1 as (select v.platform, count(*) n from public.listing_native_location_v1 v group by 1),
  sd as (select st.platform, count(*) n
           from public.listing_source_district_ar_fleet d join st using (source_table) group by 1),
  m as (
    select inv.*,
           coalesce(s.n, 0) served, coalesce(s.with_city, 0) with_city,
           coalesce(v1.n, 0) native_resolved, coalesce(sd.n, 0) sd_rows,
           inv.strategy in ('DIRECT_REVISIT', 'CANDIDATE_PLUS_DIRECT') as direct_chk,
           inv.strategy = 'SOURCE_LIST_PRESENCE' as list_chk,
           coalesce(inv.pct_verified_in_sla, 0) >= 90 as prod_ok,
           inv.active - coalesce(s.n, 0) <= greatest(5, ceil(inv.active * 0.002)) and inv.active - coalesce(v1.n, 0) <= greatest(5, ceil(inv.active * 0.002)) as loc_ok,
           coalesce(sd.n, 0) > 0 as sd_ok
      from inv left join s using (platform) left join v1 using (platform) left join sd using (platform))
  select m.platform, m.active, m.strategy,
         m.direct_chk, m.prod_ok, round(coalesce(m.pct_verified_in_sla, 0), 1),
         m.loc_ok, m.sd_ok,
         m.served, m.native_resolved,
         round(100.0 * m.with_city / nullif(m.served, 0), 1), m.sd_rows,
         nullif(concat_ws('; ',
           case when m.list_chk then 'checked daily by the site''s own complete list (owner 2026-10-02); no per-listing page check'
                when not m.direct_chk then 'no direct per-listing liveness check (crawl presence only)' end,
           case when (m.direct_chk or m.list_chk) and not m.prod_ok then
             format('liveness not verified in production (%s%% in SLA)', round(coalesce(m.pct_verified_in_sla, 0), 1)) end,
           case when not m.loc_ok then
             format('rows invisible to location detectors (served %s, resolved %s of %s)', m.served, m.native_resolved, m.active) end,
           case when m.served > 0 and m.with_city < 0.98 * m.served then
             format('%s%% of served rows have no city', round(100 - 100.0 * m.with_city / m.served, 1)) end,
           case when not m.sd_ok then 'district never compared against source' end), ''),
         case when m.prod_ok and m.loc_ok and m.sd_ok then 'PROTECTED'
              when (m.direct_chk or m.list_chk) and m.loc_ok then 'PARTIAL'
              else 'UNPROTECTED' end
    from m
   order by m.active desc;
$function$;
