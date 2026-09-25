-- listing_location_index gains WAVE 1's twenty arms — the last DB piece of their onboarding.
--
--   alsaedan  ego  muhaysini  nofodh  razre  reinvest  safa  sokok  sukna  tuba
--
-- NOT OPTIONAL (20260919184741, 20260920003543, 20260921191139): this matview is the ONLY source of
-- llc.last_updated → v1.last_updated → v2.last_updated → search_listings_ar.last_updated. A platform
-- with no arm here gets NULL last_updated, and the search orders by recency with NULLs last, so its
-- rows are present in the result set but invisible to anyone scrolling. It is also how a platform's
-- city/district spellings reach refresh_city_name_bridge / refresh_district_name_bridge.
--
-- Same machinery as 20260924171255 and 20260925020719 (abaad), widened to ten: the splice reads the
-- LIVE body at apply time and inserts before its closing ") u) v", every dependent is captured from
-- the live catalog (with definition, indexes and ACL read from pg_class.relacl, since
-- information_schema has no rows for a matview) and replayed in dependency order, and the "nothing
-- was lost" guard compares the TABLES THE DEFINITION READS before and after — never the row count,
-- because this matview refreshes daily (cron 16, 07:30 UTC) and a same-day rebuild legitimately drops
-- everything deactivated since. The twin is built FIRST, so a bad splice fails on CREATE and the
-- original is never dropped.
--
-- AFTER THE FIRST CRAWLS (cannot live in a migration — the twenty tables are empty right now):
--   refresh materialized view concurrently public.listing_location_index;
--   refresh materialized view concurrently public.listing_location_canonical_mv;
-- before the next :20 v1 refresh and :22 sync, then confirm search_listings_ar carries a non-NULL
-- last_updated for each of the ten.
--
-- The ambient statement_timeout (2 min) counts lock-wait time, so it is raised for THIS transaction
-- only; a failure still rolls the whole file back.
set local statement_timeout = '10min';
-- …but a LOCK wait fails fast: a DROP queued behind the cron would park every new reader
-- (the app's session-start location_index_live read included) behind it for up to 10 minutes.
set local lock_timeout = '15s';
do $do$
declare
  base text; arms text := ''; suffix constant text := ') u) v'; body text; r record; d record;
  before_tables text[]; lost text[]; t text;
begin
  if position('tuba_residential_listings' in
              pg_get_viewdef('public.listing_location_index'::regclass,true)) > 0 then
    raise notice 'listing_location_index already carries the wave-1 arms - nothing to do';
    return;
  end if;

  create temp table _dep_capture on commit drop as
  with recursive deps as (
    select c.oid, c.relkind, 1 lvl
    from pg_class c
    where c.oid in (
      select distinct rw.ev_class from pg_depend dp
      join pg_rewrite rw on rw.oid = dp.objid
      where dp.refobjid = 'public.listing_location_index'::regclass and dp.deptype='n'
        and rw.ev_class <> 'public.listing_location_index'::regclass)
    union
    select c2.oid, c2.relkind, deps.lvl+1
    from deps
    join pg_depend d2 on d2.refobjid = deps.oid and d2.deptype='n'
    join pg_rewrite r2 on r2.oid = d2.objid
    join pg_class c2 on c2.oid = r2.ev_class and c2.oid <> deps.oid
  ), g as (
    select oid, max(relkind::text) relkind, max(lvl) ord from deps group by oid
  )
  select c.relname::text nm, g.relkind, g.ord,
         pg_get_viewdef(g.oid, true) def,
         coalesce((select string_agg(indexdef, ';') from pg_indexes
                    where schemaname='public' and tablename = c.relname), '') idx,
         coalesce((select string_agg(format('GRANT %s ON public.%I TO %I', a.privilege_type, c.relname,
                                            pg_get_userbyid(a.grantee)), ';')
                     from aclexplode(c.relacl) a where a.grantee <> 0), '') grants
  from g join pg_class c on c.oid = g.oid;

  if (select count(*) from _dep_capture) = 0 then
    raise exception 'captured no dependents - refusing to drop anything';
  end if;
  if exists (select 1 from _dep_capture where def is null or btrim(def) = '') then
    raise exception 'a dependent definition came back empty - refusing to drop anything';
  end if;
  raise notice 'captured % dependents of listing_location_index: %', (select count(*) from _dep_capture),
    (select string_agg(nm || ':' || relkind, ', ' order by ord, nm) from _dep_capture);

  base := rtrim(rtrim(pg_get_viewdef('public.listing_location_index'::regclass,true)),';');
  select array_agg(distinct m[1]) into before_tables
    from regexp_matches(base, 'FROM (\w+_listings)\M', 'g') m;
  if coalesce(array_length(before_tables, 1), 0) < 100 then  -- 143 measured 2026-09-25
    raise exception 'read only % source tables out of the live body - probe broken, refusing to splice',
      coalesce(array_length(before_tables, 1), 0);
  end if;
  if right(base, length(suffix)) <> suffix then
    raise exception 'listing_location_index shape changed; refusing to splice';
  end if;
  body := left(base, length(base) - length(suffix));

  for r in select s.slug, s.slug || '_' || c.cat || '_listings' as tbl, c.cat
             from unnest(ARRAY['alsaedan','ego','muhaysini','nofodh','razre',
                               'reinvest','safa','sokok','sukna','tuba']) with ordinality s(slug, n)
             cross join (values (1,'residential'),(2,'commercial')) c(k, cat)
            order by s.n, c.k
  loop
    if to_regclass('public.'||r.tbl) is null then
      raise exception 'table % does not exist - apply wave1_ten_platforms_listing_tables first', r.tbl;
    end if;
    arms := arms || format($f$
UNION ALL
 SELECT ('%1$s'::text || ':'::text) || %1$I.id::text AS index_id, %1$I.id AS listing_id,
    '%2$s'::text AS platform, '%1$s'::text AS source_table, '%3$s'::text AS category,
    lower(%1$I.transaction_type) AS purpose, %1$I.region, %1$I.city,
    %1$I.neighborhood AS district, %1$I.street_name, %1$I.direction AS facade_direction,
    %1$I.last_seen_at AS last_updated, %1$I.scraped_at AS raw_created_at,
    NULL::timestamp with time zone AS raw_updated_at, %1$I.title
   FROM %1$I
  WHERE %1$I.active = true AND (%1$I.transaction_type = ANY (ARRAY['Buy'::text,'Rent'::text]))$f$,
      r.tbl, r.slug, r.cat);
  end loop;

  execute 'DROP MATERIALIZED VIEW IF EXISTS public.listing_location_index__mig CASCADE';
  execute 'CREATE MATERIALIZED VIEW public.listing_location_index__mig AS ' || body || arms || suffix;
  execute 'CREATE UNIQUE INDEX lli__mig_pk ON public.listing_location_index__mig (index_id)';

  execute 'DROP MATERIALIZED VIEW public.listing_location_index CASCADE';
  execute 'ALTER MATERIALIZED VIEW public.listing_location_index__mig RENAME TO listing_location_index';
  execute 'ALTER INDEX public.lli__mig_pk RENAME TO listing_location_index_pk';
  execute 'GRANT ALL ON public.listing_location_index TO postgres, anon, authenticated, service_role';

  for d in select * from _dep_capture order by ord, nm loop
    if d.relkind = 'm' then
      execute format('CREATE MATERIALIZED VIEW public.%I AS %s', d.nm, rtrim(rtrim(d.def), ';'));
    else
      execute format('CREATE VIEW public.%I AS %s', d.nm, rtrim(rtrim(d.def), ';'));
    end if;
    if d.idx <> '' then execute d.idx; end if;
    if d.grants <> '' then execute d.grants; end if;
  end loop;

  select array_agg(t2) into lost
    from unnest(before_tables) t2
   where position('FROM ' || t2 in pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0;
  if lost is not null then
    raise exception 'listing_location_index LOST whole source tables: %', lost;
  end if;
  if (select count(*) from public.listing_location_canonical_mv) = 0 then
    raise exception 'listing_location_canonical_mv came back empty';
  end if;
  if (select count(*) from public.listing_native_location_v1) = 0 then
    raise exception 'listing_native_location_v1 came back empty';
  end if;
  if position('tuba_residential_listings' in pg_get_viewdef('public.listing_native_location_v1'::regclass,true)) = 0 then
    raise exception 'listing_native_location_v1 was replayed WITHOUT the wave-1 ten - apply wave1_ten_wiring_into_search first';
  end if;
  -- The new arms are asserted by SHAPE, not by row count: the twenty tables were created this morning
  -- and none of the ten has crawled yet, so every one has zero rows at this moment.
  foreach t in array ARRAY['alsaedan','ego','muhaysini','nofodh','razre',
                           'reinvest','safa','sokok','sukna','tuba'] loop
    if position(t || '_residential_listings' in
                pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0
       or position(t || '_commercial_listings' in
                pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0 then
      raise exception 'the % splice did not take', t;
    end if;
  end loop;
  -- and the arms spliced on 09-24/09-25 must have survived this CASCADE
  if position('abaad_commercial_listings' in
              pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0
     or position('flow_commercial_listings' in
              pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0
     or position('dwelleo_residential_listings' in
              pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0 then
    raise exception 'an arm spliced earlier was lost';
  end if;
  raise notice 'listing_location_index: wave-1 arms spliced, % source tables kept, % dependents replayed',
    array_length(before_tables, 1), (select count(*) from _dep_capture);
end
$do$;
