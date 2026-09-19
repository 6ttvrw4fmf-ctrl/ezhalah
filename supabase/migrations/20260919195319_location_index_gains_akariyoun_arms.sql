-- listing_location_index: add the akariyoun arms its launch wiring missed — the SAME defect as
-- 20260919184741 (ksaaqar/sadiqeltajer), found by counting platforms across every registry.
--
-- HOW IT SURFACED. Every surface that must know a platform reported 51 — platform_registry,
-- ops_liveness_registry, search_listings_ar, active_listing_ids_v2 — except
-- listing_location_index, which reported 50. The missing one was akariyoun, launched the same day.
--
-- THE COST. listing_location_index is the only source of llc.last_updated -> v1 -> v2 ->
-- search_listings_ar.last_updated, so all 276 akariyoun rows (251 residential + 25 commercial)
-- carried last_updated = NULL. Note this did NOT make them invisible: sync_search_first_seen_at
-- gives every row a first_seen_at, and the recency order falls back to it — which is why
-- mon_detect_unsortable_served_listing (last_updated IS NULL *AND* first_seen_at IS NULL) stayed
-- correctly silent. What it DID cost is a real source timestamp, and akariyoun's city/district
-- spellings never reaching refresh_city_name_bridge / refresh_district_name_bridge, so its
-- location vocabulary was invisible to the catalogs that canonicalise future listings.
--
-- Same recipe as 20260919184741: capture EVERY dependent from the live catalog (a recursive walk,
-- not one hop of pg_depend — it finds thirteen objects, not two), build the new matview as a __mig
-- twin FIRST so a bad splice cannot drop the original, then replay the dependents verbatim in
-- dependency order. DDL is transactional, so any failure leaves production untouched.

do $do$
declare
  base text; arms text := ''; suffix constant text := ') u) v'; body text; r record;
  before_rows bigint; after_rows bigint; n_new bigint; d record;
begin
  if position('akariyoun_residential_listings' in
              pg_get_viewdef('public.listing_location_index'::regclass,true)) > 0 then
    raise notice 'listing_location_index already carries the akariyoun arms - nothing to do';
    return;
  end if;

  -- ── capture every dependent the CASCADE will take, in dependency order ───────────────────────
  create temp table _dep_capture2 on commit drop as
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

  if (select count(*) from _dep_capture2) = 0 then
    raise exception 'captured no dependents - refusing to drop anything';
  end if;
  if exists (select 1 from _dep_capture2 where def is null or btrim(def) = '') then
    raise exception 'a dependent definition came back empty - refusing to drop anything';
  end if;
  raise notice 'captured % dependents of listing_location_index', (select count(*) from _dep_capture2);

  select count(*) into before_rows from public.listing_location_index;

  -- ── splice the four new arms in, before the wrapper ─────────────────────────────────────────
  base := rtrim(rtrim(pg_get_viewdef('public.listing_location_index'::regclass,true)),';');
  if right(base, length(suffix)) <> suffix then
    raise exception 'listing_location_index shape changed; refusing to splice';
  end if;
  body := left(base, length(base) - length(suffix));

  for r in select * from (values
      ('akariyoun_residential_listings','akariyoun','residential'),
      ('akariyoun_commercial_listings','akariyoun','commercial')
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

  -- ── build the twin FIRST; a bad splice fails here and the original survives ──────────────────
  execute 'DROP MATERIALIZED VIEW IF EXISTS public.listing_location_index__mig CASCADE';
  execute 'CREATE MATERIALIZED VIEW public.listing_location_index__mig AS ' || body || arms || suffix;
  execute 'CREATE UNIQUE INDEX lli__mig_pk2 ON public.listing_location_index__mig (index_id)';

  execute 'DROP MATERIALIZED VIEW public.listing_location_index CASCADE';
  execute 'ALTER MATERIALIZED VIEW public.listing_location_index__mig RENAME TO listing_location_index';
  execute 'ALTER INDEX public.lli__mig_pk2 RENAME TO listing_location_index_pk';

  -- ── replay every captured dependent, in dependency order ────────────────────────────────────
  for d in select * from _dep_capture2 order by ord, nm loop
    if d.relkind = 'm' then
      execute format('CREATE MATERIALIZED VIEW public.%I AS %s', d.nm, d.def);
    else
      execute format('CREATE VIEW public.%I AS %s', d.nm, d.def);
    end if;
    if d.idx <> '' then execute d.idx; end if;
    if d.grants <> '' then execute d.grants; end if;
  end loop;

  -- ── prove it grew, the new platforms are in, and nothing came back empty ────────────────────
  select count(*) into after_rows from public.listing_location_index;
  if after_rows < before_rows then
    raise exception 'listing_location_index SHRANK % -> %', before_rows, after_rows;
  end if;
  select count(*) into n_new from public.listing_location_index
   where source_table in ('akariyoun_residential_listings','akariyoun_commercial_listings');
  if n_new = 0 then
    raise exception 'akariyoun contributed no rows - the splice did not take';
  end if;
  if (select count(*) from public.listing_location_canonical_mv) = 0 then
    raise exception 'listing_location_canonical_mv came back empty';
  end if;
  if (select count(*) from public.listing_native_location_v1) = 0 then
    raise exception 'listing_native_location_v1 came back empty';
  end if;
  raise notice 'listing_location_index % -> % rows (% from akariyoun)',
    before_rows, after_rows, n_new;
end
$do$;
