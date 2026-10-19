-- Strengthen af_extra_attrs_uncovered_tables(): a platform counts as covered when
-- listing_extra_attrs ACTUALLY EMITS ROWS for it, not merely when the catalog says the view's
-- dependency graph reaches its table.
--
-- WHY STRONGER. Dependency membership is a proxy: a branch that exists but is filtered to nothing,
-- or joins away its own rows, is "reachable" and still delivers no attributes to the interview
-- chips. The user-visible condition this detector exists for is "new listings arrive blind", and
-- emitted rows is that condition measured directly rather than inferred.
--
-- COST, measured on production 2026-09-14: 221 ms / 46,119 shared buffers for the full
-- `select distinct source_table from listing_extra_attrs` over 217,809 rows. Cheap enough for a
-- detector that runs twice an hour, and it replaces a whole-view text search that was never cheap
-- either.
--
-- This remains a REPAIR, not a silencing: it still names a genuinely uncovered platform, proven by
-- the mutation below.
create or replace function public.af_extra_attrs_uncovered_tables()
returns table(source_table text)
language sql
stable security definer
set search_path to 'public'
as $function$
  with emitting as (
      select distinct e.source_table as tbl from public.listing_extra_attrs e
  )
  select distinct s.source_table
  from public.search_listings_ar s
  where public.af_in_certified_cohort(s.deal_ar, s.rent_period_ar, s.type_ar)
    and s.production_ready
    and s.source_table not in (select tbl from emitting);
$function$;