-- ROLLBACK ARTIFACT for the 5-platform search activation (2026-09-03).
--
-- Captures the EXACT current DDL of every object the activation drops or replaces, generated from
-- the live catalog (pg_get_viewdef / pg_get_indexdef / information_schema grants) rather than
-- hand-written, so a restore replays what production actually had — not what a human believed it
-- had. This is the "commits but is wrong" recovery path: the in-transaction failure path needs
-- nothing, because Postgres DDL is transactional and rolls back on its own.
--
-- Scope: 3 matview roots (active_listing_ids_v2, listing_location_index, active_listing_ids), their
-- 13 dependents (11 views + 2 matviews), every index on those relations, and every grant.
create table if not exists public.ops_ddl_snapshot (
  id            bigserial primary key,
  taken_at      timestamptz not null default now(),
  label         text        not null,
  obj_schema    text        not null,
  obj_name      text        not null,
  obj_kind      text        not null,          -- view | matview | index | grant
  ordinal       int         not null default 0, -- dependency / recreate order
  ddl           text        not null
);
comment on table public.ops_ddl_snapshot is
  'Point-in-time DDL captures taken before a high-risk view/matview rebuild, used as the restore '
  'script if the change commits but proves wrong. Written by the engineer performing the change.';

with objs as (
  select c.oid, c.relname::text nm, c.relkind,
         case c.relname
           when 'active_listing_ids'             then 1
           when 'active_listing_ids_v2'          then 2
           when 'listing_location_index'         then 3
           when 'listing_location_canonical_mv'  then 4
           when 'listing_native_location_v1'     then 5
           when 'listing_location_canonical'     then 6
           when 'listing_extra_attrs'            then 7
           when 'listing_rich_attrs'             then 8
           when 'listing_native_location_v2'     then 9
           else 20 end as ord
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v','m')
    and c.relname in (
      'active_listing_ids','active_listing_ids_v2','listing_location_index',
      'listing_location_canonical','listing_location_canonical_mv','listing_native_location_v1',
      'listing_native_location_v2','buy_location_index','rent_location_index','location_index_live',
      'location_review','ops_freshness_by_layer','phasea_shadow_resolution',
      'mon_search_index_city_drift','platforms_deprecated_status','platforms_unsearchable',
      'listing_extra_attrs','listing_rich_attrs')
)
insert into public.ops_ddl_snapshot (label, obj_schema, obj_name, obj_kind, ordinal, ddl)
select 'pre_5_platform_activation_20260903', 'public', o.nm,
       case o.relkind when 'v' then 'view' else 'matview' end,
       o.ord,
       format('CREATE %s public.%I AS %s',
              case o.relkind when 'v' then 'OR REPLACE VIEW' else 'MATERIALIZED VIEW' end,
              o.nm, pg_get_viewdef(o.oid, true))
from objs o
union all
select 'pre_5_platform_activation_20260903', 'public', i.tablename, 'index', 50, i.indexdef
from pg_indexes i
where i.schemaname = 'public'
  and i.tablename in ('active_listing_ids','active_listing_ids_v2','listing_location_index',
                      'listing_location_canonical_mv','listing_native_location_v1')
union all
select 'pre_5_platform_activation_20260903', 'public', g.table_name, 'grant', 60,
       format('GRANT %s ON public.%I TO %I;', g.privilege_type, g.table_name, g.grantee)
from information_schema.role_table_grants g
where g.table_schema = 'public'
  and g.table_name in (select nm from objs);

select label, obj_kind, count(*) captured
from public.ops_ddl_snapshot
where label = 'pre_5_platform_activation_20260903'
group by 1,2 order by 2;
