-- ops_af_attribute_coverage(): make the transitive dependency walk terminate on DISTINCT relations.
--
-- WHAT WAS WRONG. The recursive `deps` CTE carried a `depth` column and combined with UNION ALL, so
-- the same relation was re-walked once per distinct path length reaching it. Measured 2026-09-14 on
-- production: 1,390 rows at depth 1 -> 2,110 -> 284,686 -> 849,118 at depth 4, while the walk only
-- ever touches 105 DISTINCT relations. With the original `depth < 8` cap the function did not return
-- inside a 60s statement timeout at all.
--
-- WHY IT MATTERS HERE. This function IS the canonical answer to "does every searchable platform have
-- AF attribute coverage", and two live barriers call it over the anon path every 6 hours
-- (verify-af-attribute-views-cover-every-platform-live.ts). A barrier whose only question is
-- unanswerable reads as an outage, not as a clean bill of health — and the fail-closed half then
-- fails UNRELATED work. ops_incident #127 fixed an earlier version of this slowness by resolving only
-- the 88 candidate table names; the transitive-wrapper walk added afterwards re-introduced it in a
-- new shape.
--
-- THE FIX, AND WHY IT IS NOT A WEAKENING. Drop `depth` from the row and use UNION instead of
-- UNION ALL. Dedup is what bounds the walk: a relation already recorded for a view is never expanded
-- again, the working table empties, and the recursion terminates on its own. Measured after:
-- 189 rows, 85 ms.
--
-- This is strictly MORE correct than before, not less. `depth < 8` was a truncation: a platform
-- nested more than eight wrapper views deep was silently reported as NOT covered. Removing the cap
-- removes that false negative. Verified on production immediately after: 48 platforms, 0 missing
-- from listing_rich_attrs, 0 missing from listing_extra_attrs, HTTP 200 over the anon REST path in
-- 0.62-1.45s across three consecutive calls.
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
    --
    -- UNION, not UNION ALL, and no `depth` column: the dedup IS the termination condition. Carrying
    -- depth made every row distinct, so nothing was ever deduped and each relation was re-expanded
    -- once per path reaching it — an exponential blowup that no depth cap can make cheap.
    deps as (
      select v.viewname, d.refobjid as reloid, cl.relkind
      from (values ('listing_rich_attrs'),('listing_extra_attrs')) v(viewname)
      join pg_rewrite r on r.ev_class = ('public.'||v.viewname)::regclass
                       and r.rulename = '_RETURN'
      join pg_depend d on d.objid = r.oid and d.refclassid = 'pg_class'::regclass
      join pg_class cl on cl.oid = d.refobjid
      union
      select dp.viewname, d.refobjid, cl.relkind
      from deps dp
      join pg_rewrite r on r.ev_class = dp.reloid and r.rulename = '_RETURN'
      join pg_depend d on d.objid = r.oid and d.refclassid = 'pg_class'::regclass
      join pg_class cl on cl.oid = d.refobjid
      where dp.relkind = 'v'
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
