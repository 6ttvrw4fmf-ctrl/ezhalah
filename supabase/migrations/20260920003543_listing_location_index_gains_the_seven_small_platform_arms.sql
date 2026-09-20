-- listing_location_index gains arms for the seven platforms onboarded today.
--
-- WHY THIS IS NOT OPTIONAL, and what skipping it cost last time (20260919184741): this matview is
-- the ONLY source of llc.last_updated → v1.last_updated → v2.last_updated →
-- search_listings_ar.last_updated. A LEFT JOIN against a matview with no row for the platform
-- yields NULL, and the search orders by recency with NULL last. ksaaqar and sadiqeltajer were
-- wired into search but not here, so all 2,737 of their rows sat behind ~40,000 others: present in
-- the result set, invisible to any human scrolling. A count-based check passes on that; only
-- testing the deployed app as a real user finds it.
--
-- Secondary cost: a platform absent here never contributes its city/district spellings to
-- refresh_city_name_bridge / refresh_district_name_bridge, so its location vocabulary stays
-- invisible to the catalogs that canonicalise future listings.
--
-- RECIPE: capture EVERY dependent from the live catalog — a recursive walk, not one hop of
-- pg_depend, which reports two objects where there are thirteen. Definitions, matview indexes and
-- grants are read moments before the CASCADE and replayed in dependency order. The new matview is
-- built as a __mig twin FIRST, so a bad splice fails on CREATE and the original is never dropped.
do $do$
declare
  base text; arms text := ''; suffix constant text := ') u) v'; body text; r record;
  before_rows bigint; after_rows bigint; n_new bigint; d record;
begin
  if position('gudai_residential_listings' in
              pg_get_viewdef('public.listing_location_index'::regclass,true)) > 0 then
    raise notice 'listing_location_index already carries the new arms - nothing to do';
    return;
  end if;

  create temp table _dep_capture on commit drop as
  with recursive deps as (
    select c.oid, c.relname::text nm, c.relkind, 1 lvl
    from pg_class c
    where c.oid in (
      select distinct rw.ev_class from pg_depend dp
      join pg_rewrite rw on rw.oid = dp.objid
      where dp.refobjid = 'public.listing_location_index'::regclass and dp.deptype='n'
        and rw.ev_class <> 'public.listing_location_index'::regclass)
    union
    select c2.oid, c2.relname::text, c2.relkind, deps.lvl+1
    from deps
    join pg_depend d2 on d2.refobjid = deps.oid and d2.deptype='n'
    join pg_rewrite r2 on r2.oid = d2.objid
    join pg_class c2 on c2.oid = r2.ev_class and c2.oid <> deps.oid
  )
  select nm, max(relkind::text) relkind, max(lvl) ord,
         pg_get_viewdef(min(oid)::regclass, true) def,
         coalesce((select string_agg(indexdef, ';') from pg_indexes
                    where schemaname='public' and tablename = deps.nm), '') idx,
         coalesce((select string_agg(
                     format('GRANT %s ON public.%I TO %I', privilege_type, nm, grantee), ';')
                   from information_schema.role_table_grants
                   where table_schema='public' and table_name = deps.nm), '') grants
  from deps group by nm;

  if (select count(*) from _dep_capture) = 0 then
    raise exception 'captured no dependents - refusing to drop anything';
  end if;
  if exists (select 1 from _dep_capture where def is null or btrim(def) = '') then
    raise exception 'a dependent definition came back empty - refusing to drop anything';
  end if;
  raise notice 'captured % dependents of listing_location_index', (select count(*) from _dep_capture);

  select count(*) into before_rows from public.listing_location_index;

  base := rtrim(rtrim(pg_get_viewdef('public.listing_location_index'::regclass,true)),';');
  if right(base, length(suffix)) <> suffix then
    raise exception 'listing_location_index shape changed; refusing to splice';
  end if;
  body := left(base, length(base) - length(suffix));

  for r in select * from (values
      ('gudai_residential_listings','gudai','residential'),
      ('gudai_commercial_listings','gudai','commercial'),
      ('safera_residential_listings','safera','residential'),
      ('safera_commercial_listings','safera','commercial'),
      ('alhumaidan_residential_listings','alhumaidan','residential'),
      ('alhumaidan_commercial_listings','alhumaidan','commercial'),
      ('aqarnajran_residential_listings','aqarnajran','residential'),
      ('aqarnajran_commercial_listings','aqarnajran','commercial'),
      ('fahadalshahri_residential_listings','fahadalshahri','residential'),
      ('fahadalshahri_commercial_listings','fahadalshahri','commercial'),
      ('compoundin_residential_listings','compoundin','residential'),
      ('compoundin_commercial_listings','compoundin','commercial'),
      ('wslnaa_residential_listings','wslnaa','residential'),
      ('wslnaa_commercial_listings','wslnaa','commercial')
    ) as x(tbl,slug,cat)
  loop
    if to_regclass('public.'||r.tbl) is null then
      raise exception 'table % does not exist - refusing to guess', r.tbl;
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

  for d in select * from _dep_capture order by ord, nm loop
    if d.relkind = 'm' then
      execute format('CREATE MATERIALIZED VIEW public.%I AS %s', d.nm, d.def);
    else
      execute format('CREATE VIEW public.%I AS %s', d.nm, d.def);
    end if;
    if d.idx <> '' then execute d.idx; end if;
    if d.grants <> '' then execute d.grants; end if;
  end loop;

  select count(*) into after_rows from public.listing_location_index;
  if after_rows < before_rows then
    raise exception 'listing_location_index SHRANK % -> %', before_rows, after_rows;
  end if;
  if (select count(*) from public.listing_location_canonical_mv) = 0 then
    raise exception 'listing_location_canonical_mv came back empty';
  end if;
  if (select count(*) from public.listing_native_location_v1) = 0 then
    raise exception 'listing_native_location_v1 came back empty';
  end if;
  -- The arms are asserted by SHAPE, not by row count: every one of these platforms has zero rows
  -- at this moment (the tables were created minutes ago and no sweep has run), so a row-count
  -- assertion here would be asserting the wrong thing and would fail for the right reason.
  if position('wslnaa_residential_listings' in
              pg_get_viewdef('public.listing_location_index'::regclass,true)) = 0 then
    raise exception 'the splice did not take';
  end if;
  raise notice 'listing_location_index % -> % rows; seven platform arms spliced', before_rows, after_rows;
end
$do$;
