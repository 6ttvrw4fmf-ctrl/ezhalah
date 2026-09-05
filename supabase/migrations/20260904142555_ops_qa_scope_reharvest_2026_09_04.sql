-- ops_qa_scope RE-HARVEST (Data Integrity run 2026-09-04).
--
-- WHY. The registry's 'res'/'com' base scopes were the 2026-08-20 harvest: 31 tables each. On
-- 2026-09-03, PR #1548 shipped five audited platforms (therc, aouj, abralosol, arkaan, rawasidark)
-- into RES_TABLES/COM_TABLES and into production. The registry was never re-harvested, so
-- mon_detect_search_scope_unreachable_inventory() saw ten tables holding 4,500 production_ready rows
-- in no client scope and raised ten P1s reading "stored, indexed and invisible".
--
-- They were never invisible. The DEPLOYED production bundle
-- (https://ezhalah-app.vercel.app/_expo/static/js/web/entry-4d75598c3d2da1d6ad873697a7541567.js,
-- deployment dpl_D28PgeNtgS7tz1yb15eCrYmqrbtb = commit 1d80155) ships 36 residential and 36
-- commercial tables, all ten of them included. That bundle -- not src/ -- is the harvest, keeping the
-- 2026-08-20 rule that this registry records what production SENDS, not what the repo claims.
--
-- THE ALARM WAS FALSE, AND THAT IS THE DAMAGE. This detector's true alarm -- a platform live in
-- search_listings_ar but absent from the client, the exact 2026-09-03 Trending defect -- is
-- indistinguishable from this false one. Severity is deliberately NOT downgraded: the fix is to stop
-- the registry lagging the client, enforced offline by scripts/verify-qa-scope-registry-current.ts.
--
-- Only 'res' and 'com' carry literals; every other scope is re-derived from them by the same set
-- math as 20260820092245, so the registry keeps ONE definition of each table list.
insert into public.ops_qa_scope (scope, tables, note) values
 ('res', array['aqar_residential_listings','wasalt_residential_listings','aldarim_residential_listings','aqargate_residential_listings','alhoshan_residential_listings','hajer_residential_listings','sanadak_residential_listings','eastabha_residential_listings','aqarcity_residential_listings','raghdan_residential_listings','eaqartabuk_residential_listings','satel_residential_listings','sadin_residential_listings','toor_residential_listings','mustqr_residential_listings','ramzalqasim_residential_listings','fursaghyr_residential_listings','jazwtn_residential_listings','mizlaj_residential_listings','muktamel_residential_listings','aqaratikom_residential_listings','awal_residential_listings','alkhaas_residential_listings','abeea_residential_listings','jurash_residential_listings','alnokhba_residential_listings','dealapp_residential_listings','erapulse_residential_listings','nowaisiry_residential_listings','october_residential_listings','souq24_residential_listings','therc_residential_listings','aouj_residential_listings','abralosol_residential_listings','arkaan_residential_listings','rawasidark_residential_listings'],
  'RES_TABLES as SENT BY PRODUCTION on a non-monthly search (re-harvested 2026-09-04 from the deployed bundle at commit 1d80155)'),
 ('com', array['aqar_commercial_listings','wasalt_commercial_listings','aldarim_commercial_listings','aqargate_commercial_listings','alhoshan_commercial_listings','hajer_commercial_listings','sanadak_commercial_listings','eastabha_commercial_listings','aqarcity_commercial_listings','raghdan_commercial_listings','eaqartabuk_commercial_listings','satel_commercial_listings','sadin_commercial_listings','toor_commercial_listings','mustqr_commercial_listings','ramzalqasim_commercial_listings','fursaghyr_commercial_listings','jazwtn_commercial_listings','mizlaj_commercial_listings','muktamel_commercial_listings','aqaratikom_commercial_listings','awal_commercial_listings','alkhaas_commercial_listings','abeea_commercial_listings','jurash_commercial_listings','alnokhba_commercial_listings','dealapp_commercial_listings','erapulse_commercial_listings','nowaisiry_commercial_listings','october_commercial_listings','souq24_commercial_listings','therc_commercial_listings','aouj_commercial_listings','abralosol_commercial_listings','arkaan_commercial_listings','rawasidark_commercial_listings'],
  'COM_TABLES as SENT BY PRODUCTION (re-harvested 2026-09-04 from the deployed bundle at commit 1d80155)')
on conflict (scope) do update set tables = excluded.tables, harvested_at = now(), note = excluded.note;

-- Derived scopes, recomputed from the refreshed base scopes.
insert into public.ops_qa_scope (scope, tables, note)
select 'resm',
       array(select unnest(tables) from public.ops_qa_scope where scope='res'
             union select unnest(array['gathern_residential_listings','aqarmonthly_residential_listings'])),
       'RES_TABLES + the two monthly-only sources, as sent when the period scope includes شهري'
on conflict (scope) do update set tables=excluded.tables, harvested_at=now(), note=excluded.note;

insert into public.ops_qa_scope (scope, tables, note)
select 's1',
       array(select unnest(tables) from public.ops_qa_scope where scope='res'
             union select unnest(tables) from public.ops_qa_scope where scope='com'),
       'both-kind scope: cohorts whose CleanQuery spans residential AND commercial tables (re-harvested 2026-09-04)'
on conflict (scope) do update set tables=excluded.tables, harvested_at=now(), note=excluded.note;

insert into public.ops_qa_scope (scope, tables, note)
select 's2',
       array(select unnest(tables) from public.ops_qa_scope where scope='com'
             union select 'dealapp_residential_listings'),
       'commercial scope + dealapp_residential overlay (مكتب) -- re-harvested 2026-09-04'
on conflict (scope) do update set tables=excluded.tables, harvested_at=now(), note=excluded.note;

insert into public.ops_qa_scope (scope, tables, note)
select 's1m',
       array(select unnest(tables) from public.ops_qa_scope where scope='s1'
             union select unnest(array['gathern_residential_listings','aqarmonthly_residential_listings'])),
       'monthly variant of s1'
on conflict (scope) do update set tables=excluded.tables, harvested_at=now(), note=excluded.note;

-- Fail closed: the ten tables this run adjudicated must now be reachable, and the two monthly-only
-- sources must remain reachable ONLY through the *m scopes (the 2026-08-20 invariant).
do $$
declare v_unreachable text[];
begin
  select coalesce(array_agg(distinct s.source_table), '{}')
    into v_unreachable
    from public.search_listings_ar s
   where s.production_ready
     and not exists (select 1 from public.ops_qa_scope q where s.source_table = any(q.tables));
  if cardinality(v_unreachable) > 0 then
    raise exception 'ops_qa_scope refresh left production_ready tables unreachable: %', v_unreachable;
  end if;
  if exists (select 1 from public.ops_qa_scope where scope in ('res','com','s1','s2')
              and ('gathern_residential_listings' = any(tables) or 'aqarmonthly_residential_listings' = any(tables))) then
    raise exception 'monthly-only sources leaked into a non-monthly scope';
  end if;
end $$;
