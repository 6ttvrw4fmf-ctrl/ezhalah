-- mon_af_new_listing_readiness() section A: ask the CATALOG which tables listing_extra_attrs really
-- covers, instead of string-searching the view's SQL text.
--
-- THE DEFECT. Section A decided coverage with
--     position(s.source_table in pg_get_viewdef('public.listing_extra_attrs'))  = 0
-- listing_extra_attrs is a thin WRAPPER: its whole definition is 3,562 characters of column list
-- selecting from listing_extra_attrs_v1. Not ONE platform table name appears in that text. So the
-- test returned "unmapped" for every certified-cohort platform in the fleet, unconditionally.
--
-- MEASURED, 2026-09-14: open P1 alert_event 2705 named 77 tables as having "NO listing_extra_attrs
-- branch ... blind to every Advanced-Filter chip". Every one of them demonstrably has rows —
-- amlakalahsa 264, abeea 159, aldarim 135, october 12, wasalt 52,873. The alert was 100% false and
-- had been re-affirmed daily since 2026-09-13.
--
-- WHY THIS MATTERED BEYOND THE NOISE. A detector that always cries wolf cannot distinguish a real
-- gap from its own noise. amlakalahsa's GENUINE coverage gap (ops_incident #230, fixed today)
-- sat unworked for days while this P1 was on screen claiming 77 platforms were broken. A barrier
-- that reports everything reports nothing.
--
-- THE FIX IS NOT A SILENCING. It replaces a text match with the transitive dependency walk the
-- catalog can actually answer — the same technique ops_af_attribute_coverage() uses, and it still
-- fires for a genuinely uncovered platform (mutation-proven below). UNION with no depth column, so
-- dedup bounds the recursion and a wrapper nested any number of views deep is still resolved.
create or replace function public.af_extra_attrs_uncovered_tables()
returns table(source_table text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with recursive deps as (
      select d.refobjid as reloid, cl.relkind
      from pg_rewrite r
      join pg_depend d on d.objid = r.oid and d.refclassid = 'pg_class'::regclass
      join pg_class cl on cl.oid = d.refobjid
      where r.ev_class = 'public.listing_extra_attrs'::regclass and r.rulename = '_RETURN'
      union
      select d.refobjid, cl.relkind
      from deps dp
      join pg_rewrite r on r.ev_class = dp.reloid and r.rulename = '_RETURN'
      join pg_depend d on d.objid = r.oid and d.refclassid = 'pg_class'::regclass
      join pg_class cl on cl.oid = d.refobjid
      where dp.relkind = 'v'
  ),
  covered as (
      select distinct c.relname::text as tbl
      from deps join pg_class c on c.oid = deps.reloid
  )
  select distinct s.source_table
  from public.search_listings_ar s
  where public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar)
    and s.production_ready
    and s.source_table not in (select tbl from covered);
$function$;

-- Splice section A to call it, leaving the rest of the function untouched.
do $splice$
declare def text; old_block constant text :=
'  select pg_get_viewdef(''public.listing_extra_attrs''::regclass, true) into def;
  select string_agg(distinct s.source_table, '', '') into missing
    from public.search_listings_ar s
   where public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar) and s.production_ready
     and position(s.source_table in def) = 0;';
  new_block constant text :=
'  -- Catalog membership, not a text search of the view body: listing_extra_attrs is a WRAPPER over
  -- listing_extra_attrs_v1, so no platform table name appears in its own SQL and the old
  -- position()-based test reported the entire fleet as unmapped (false P1 alert_event 2705,
  -- 77 tables, every one of which had rows). See af_extra_attrs_uncovered_tables().
  select string_agg(u.source_table, '', '' order by u.source_table) into missing
    from public.af_extra_attrs_uncovered_tables() u;';
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='mon_af_new_listing_readiness';

  if def is null then
    raise exception 'mon_af_new_listing_readiness not found - refusing to guess';
  end if;
  if position(old_block in def) = 0 then
    raise exception 'section A does not match the expected text - shape changed, refusing to splice';
  end if;

  execute replace(def, old_block, new_block);

  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='mon_af_new_listing_readiness';
  if position('af_extra_attrs_uncovered_tables' in def) = 0 then
    raise exception 'splice did not take';
  end if;
  if position('position(s.source_table in def)' in def) > 0 then
    raise exception 'the old text-match test is still present after the splice';
  end if;
end
$splice$;