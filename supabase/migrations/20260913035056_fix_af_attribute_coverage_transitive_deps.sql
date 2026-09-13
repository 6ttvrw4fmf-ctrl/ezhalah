-- ops_af_attribute_coverage() walked exactly ONE hop of pg_depend from listing_rich_attrs /
-- listing_extra_attrs to find each platform's backing table. That was correct while both views
-- were flat 90-branch UNION ALLs. The 2026-09-13 amlakalahsa fix (migration
-- 20260913025049_amlakalahsa_extra_attrs_registration) split listing_extra_attrs into a thin
-- wrapper ("SELECT * FROM listing_extra_attrs_v0 UNION ALL <amlakalahsa>") to dodge a statement
-- timeout on the full 64KB CREATE OR REPLACE — which means every ORIGINAL platform's table is now
-- ONE HOP FURTHER from listing_extra_attrs than this function's single-level pg_depend lookup
-- can see. Result: ops_af_attribute_coverage() has been reporting in_extra=false for ~44 real,
-- fully-wired platforms (abeea/aqar/wasalt/... all confirmed populated) ever since — a false
-- alarm on the exact CI guard (.github/workflows/loader-active-platforms-check.yml ->
-- verify-af-attribute-views-cover-every-platform-live.ts) this repo relies on to catch platforms
-- that silently AREN'T wired. Found auditing amlakalahsa for the same bug class elsewhere
-- (2026-09-13); this is a regression from that earlier fix, not a pre-existing issue.
--
-- Fix: walk pg_depend/pg_rewrite TRANSITIVELY (not just one hop) — any dependency that is ITSELF
-- a view gets its own direct dependencies pulled in too, repeated up to depth 8 (generous
-- headroom; today's real nesting is 2 levels). This keeps the existing "88 candidate table name
-- lookups, never all 2,326 relations" performance guard (see the untouched cand_oid CTE below)
-- while making the reachability check correct regardless of how many wrapper layers a view
-- accumulates over time. Verified against live prod before applying: abeea/aqar/wasalt now
-- correctly show in_extra=true; amlakalahsa still in_extra=true, in_rich=false (a real, separate,
-- pre-existing gap — amlakalahsa has 0 rows in listing_rich_attrs, unrelated to this bug, not
-- touched here); fleet-wide not_in_extra dropped from ~44 to 0, not_in_rich stayed at exactly 1
-- (amlakalahsa) out of 45 total platforms.
create or replace function public.ops_af_attribute_coverage()
 returns table(platform text, in_rich boolean, in_extra boolean, searchable_rows bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with recursive searchable as (
      select split_part(v.source_table,'_',1) as platform, count(*) as n
      from active_listing_ids_v2 v
      group by 1
    ),
    -- Resolve ONLY the two candidate table names per platform (88 index lookups), never all 2,326
    -- dependencies. Doing it the other way round measured WORSE than the original.
    cand_oid as (
      select s.platform, cl.oid as reloid
      from searchable s
      cross join lateral (values (s.platform||'_residential_listings'),
                                 (s.platform||'_commercial_listings')) t(tname)
      join pg_class cl on cl.relname = t.tname::name
                      and cl.relnamespace = 'public'::regnamespace
                      and cl.relkind in ('r','v','m','p')
    ),
    -- Which relations does each view ULTIMATELY depend on, walked transitively through any number
    -- of intermediate wrapper views (a view can be "SELECT * FROM other_view UNION ALL ..." —
    -- a single-hop lookup only sees the wrapper's own direct refs and silently loses every
    -- platform nested one level deeper).
    deps as (
      select v.viewname, d.refobjid as reloid, cl.relkind, 1 as depth
      from (values ('listing_rich_attrs'),('listing_extra_attrs')) v(viewname)
      join pg_rewrite r on r.ev_class = ('public.'||v.viewname)::regclass
                       and r.rulename = '_RETURN'
      join pg_depend d on d.objid = r.oid and d.refclassid = 'pg_class'::regclass
      join pg_class cl on cl.oid = d.refobjid
      union all
      select dp.viewname, d.refobjid, cl.relkind, dp.depth + 1
      from deps dp
      join pg_rewrite r on r.ev_class = dp.reloid and r.rulename = '_RETURN'
      join pg_depend d on d.objid = r.oid and d.refclassid = 'pg_class'::regclass
      join pg_class cl on cl.oid = d.refobjid
      where dp.relkind = 'v' and dp.depth < 8
    )
    select s.platform,
           exists (select 1 from deps dp join cand_oid co on co.reloid = dp.reloid
                   where dp.viewname = 'listing_rich_attrs'  and co.platform = s.platform) as in_rich,
           exists (select 1 from deps dp join cand_oid co on co.reloid = dp.reloid
                   where dp.viewname = 'listing_extra_attrs' and co.platform = s.platform) as in_extra,
           s.n as searchable_rows
    from searchable s
    order by s.platform;
$function$;