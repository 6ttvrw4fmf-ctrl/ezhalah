-- listing_location_index gains squares' and rawaf's four arms — the last DB piece of their
-- onboarding.
--
-- listing_location_index is the ONLY source of last_updated. A platform without an arm here gets
-- NULL, sorts last, and vanishes when the user scrolls — the bug wave-1, wave-2 and wahadat all hit.
--
-- Machinery is 20260926101332 (wahadat) / 20260926043530 (wave-2): capture every dependent, refuse
-- on a broken probe, splice arms into the body read LIVE at apply time, build a populated __mig
-- twin, swap, replay dependents. Any failed assertion rolls the whole file back.
--
-- AFTER THIS LANDS the refresh chain must run IN THIS ORDER before the next sync, or the new rows
-- still land with NULL last_updated:
--   refresh materialized view concurrently public.listing_location_index;
--   refresh materialized view concurrently public.listing_location_canonical_mv;
--   refresh materialized view concurrently public.listing_native_location_v1;   <-- v1 reads canonical
--   select * from public.sync_search_listings_ar();
set local statement_timeout = '10min';
set local lock_timeout = '15s';
do $do$
declare
  base text; arms text := ''; suffix constant text := ') u) v'; body text; r record; d record;
  before_tables text[]; lost text[];
begin
  if position('squares_residential_listings' in
              pg_get_viewdef('public.listing_location_index'::regclass,true)) > 0 then
    raise notice 'listing_location_index already carries the squares/rawaf arms - nothing to do';
    return;
  end if;

  create temp table _dep_capture on commit drop as
  with recursive deps as (
    select c.oid, c.relkind, 1 lvl
    from pg_class c
    where c.oid in (
      select distinct rw.ev_class from pg_depend dp join pg_rewrite rw on rw.oid = dp.objid
      where dp.refobjid = 'public.listing_location_index'::regclass and dp.deptype='n'
        and rw.ev_class <> 'public.listing_location_index'::regclass)
    union
    select c2.oid, c2.relkind, deps.lvl+1
    from deps
    join pg_depend d2 on d2.refobjid = deps.oid and d2.deptype='n'
    join pg_rewrite r2 on r2.oid = d2.objid
    join pg_class c2 on c2.oid = r2.ev_class and c2.oid <> deps.oid
  ), g as (select oid, max(relkind::text) relkind, max(lvl) ord from deps group by oid)
  select c.relname::text nm, g.relkind, g.ord,
         pg_get_viewdef(g.oid, true) def,
         coalesce((select string_agg(indexdef,';') from pg_indexes
                    where schemaname='public' and tablename=c.relname),'') idx,
         coalesce((select string_agg(format('GRANT %s ON public.%I TO %I', a.privilege_type, c.relname,
                                            pg_get_userbyid(a.grantee)),';')
                     from aclexplode(c.relacl) a where a.grantee <> 0),'') grants
  from g join pg_class c on c.oid = g.oid;

  if (select count(*) from _dep_capture) = 0 then
    raise exception 'captured ZERO dependents - probe broken, refusing to drop anything';
  end if;
  if exists (select 1 from _dep_capture where def is null or btrim(def) = '') then
    raise exception 'a dependent definition came back empty - refusing to drop anything';
  end if;

  base := rtrim(rtrim(pg_get_viewdef('public.listing_location_index'::regclass,true)),';');
  select array_agg(distinct m[1]) into before_tables
    from regexp_matches(base, 'FROM (\w+_listings)\M', 'g') m;
  if coalesce(array_length(before_tables, 1), 0) < 100 then
    raise exception 'read only % source tables out of the live body - probe broken, refusing to splice',
      coalesce(array_length(before_tables, 1), 0);
  end if;
  if right(base, length(suffix)) <> suffix then
    raise exception 'listing_location_index shape changed; refusing to splice';
  end if;
  body := left(base, length(base) - length(suffix));

  for r in select s.slug, s.slug || '_' || c.cat || '_listings' as tbl, c.cat
             from unnest(ARRAY['squares','rawaf']) with ordinality s(slug, n)
             cross join (values (1,'residential'),(2,'commercial')) c(k, cat)
            order by s.n, c.k
  loop
    if to_regclass('public.'||r.tbl) is null then
      raise exception 'table % does not exist - apply squares_rawaf_listing_tables first', r.tbl;
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

  select array_agg(distinct m[1]) filter (where position('FROM '||m[1] in
           pg_get_viewdef('public.listing_location_index__mig'::regclass,true)) = 0)
    into lost
    from regexp_matches(base, 'FROM (\w+_listings)\M', 'g') m;
  if lost is not null then
    raise exception 'listing_location_index splice lost source tables: %', lost;
  end if;

  execute 'DROP MATERIALIZED VIEW public.listing_location_index CASCADE';
  execute 'ALTER MATERIALIZED VIEW public.listing_location_index__mig RENAME TO listing_location_index';
  execute 'ALTER INDEX public.lli__mig_pk RENAME TO listing_location_index_pk';
  execute 'GRANT ALL ON public.listing_location_index TO postgres, anon, authenticated, service_role';

  for d in select * from _dep_capture order by ord, nm loop
    if to_regclass('public.' || d.nm) is not null then
      continue;
    end if;
    if d.relkind = 'm' then
      execute format('CREATE MATERIALIZED VIEW public.%I AS %s', d.nm, rtrim(rtrim(d.def),';'));
    else
      execute format('CREATE VIEW public.%I AS %s', d.nm, rtrim(rtrim(d.def),';'));
    end if;
    if d.idx <> '' then execute d.idx; end if;
    if d.grants <> '' then execute d.grants; end if;
  end loop;
end
$do$;

do $verify$
declare t text; missing text;
begin
  foreach t in array array['squares','rawaf'] loop
    if position(t || '_residential_listings' in pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0
       or position(t || '_commercial_listings' in pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0 then
      raise exception '% did not land in listing_location_index', t;
    end if;
  end loop;
  if position('wahadat_residential_listings' in pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0
     or position('tuba_residential_listings' in pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0 then
    raise exception 'an existing platform arm was lost while adding the new ones';
  end if;
  select string_agg(v, ', ') into missing
    from unnest(ARRAY['listing_location_canonical_mv','listing_location_canonical']) v
   where to_regclass('public.'||v) is null;
  if missing is not null then
    raise exception 'CASCADE ate these and replay did not restore them: %', missing;
  end if;
  if (select count(*) from public.listing_location_index) = 0 then
    raise exception 'the rebuilt listing_location_index came back empty';
  end if;
  raise notice 'squares + rawaf are in listing_location_index';
end
$verify$;
