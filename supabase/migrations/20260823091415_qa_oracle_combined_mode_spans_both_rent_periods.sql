-- The §40.5 oracle must model Buy+Rent COMBINED mode the way the client actually searches it.
--
-- Found by the daily Search & Matching QA run (2026-08-23) while covering the owner's Buy+Rent
-- combined feature (2026-08-20). Live production, شقة / الرياض, combined mode:
--
--     UI headline        30,399   («لقينا 30,399 إعلان يطابق طلبك.»)
--     RPC total_count    30,399   (1,500-row page, 0 duplicate ids)
--     independent SQL    30,399   (distinct source_table+listing_id over the client's own scope)
--     ops_qa_diff        21,765   <- the oracle alone disagreed
--
-- 30,399 - 21,765 = 8,634 = exactly the contribution of the two monthly-only sources
-- (gathern_residential_listings, aqarmonthly_residential_listings).
--
-- Root cause: ops_qa_diff picked the monthly table scope with
--     c.macro = 'Residential' and p_deal = 'إيجار' and p_period in ('شهري','كلاهما')
-- In combined mode the client sends p_deal = NULL and p_rent_period = NULL, because the mode has
-- no period selector and its Rent side ALWAYS spans both periods (SEARCH_MATCH_QA_ENGINEER §40.2).
-- p_deal = 'إيجار' is false for NULL, so the oracle scoped to 31 tables while the client harvested
-- 33 -- the §41.6 trap ("guessing this mapping made the differential oracle under-count five
-- searches; they read as product defects until the mapping was re-derived from the harvest"),
-- reached this time through the deal arm rather than the period arm.
--
-- The product is CORRECT and unchanged. This is a barrier defect: any combined-mode search put
-- through ops_qa_adjudicate would have been stamped COUNT_MISMATCH against perfectly good
-- behaviour. ops_qa_search_run has never held a single combined-mode row (deal IS NULL: 0 of 710),
-- so this latent gap had never been exercised -- and it sits precisely on the feature §40.2 says a
-- major certification is INCOMPLETE without. No existing verdict changes.
--
-- Parameter defaults are reproduced verbatim: dropping the function to change them would churn the
-- signature (and PostgREST's overload resolution) for a pure body fix.

create or replace function public.ops_qa_diff(
  p_ui_type text,
  p_deal text default null::text,
  p_period text default null::text,
  p_cities text[] default null::text[],
  p_districts text[] default null::text[],
  p_region_ids integer[] default null::integer[],
  p_amin integer default null::integer,
  p_amax integer default null::integer,
  p_beds integer[] default null::integer[],
  p_bmin integer default null::integer,
  p_pmin numeric default null::numeric,
  p_pmax numeric default null::numeric)
returns table(n bigint, h text)
language sql stable
as $function$
  select d.n, d.h
  from public.ops_qa_cohort c
  cross join lateral public.ops_qa_search_differential(
    public.ops_qa_scope_tables(
      case when c.macro = 'Residential'
            and (
              -- explicit Rent search that reaches monthly inventory
              (p_deal = 'إيجار' and p_period in ('شهري','كلاهما'))
              -- Buy+Rent COMBINED (owner 2026-08-20): no period selector, so the client sends
              -- deal NULL + period NULL and its Rent side spans BOTH periods (§40.2). Verified
              -- against the harvested request: 33 tables, never 31.
              or (p_deal is null and p_period is null)
            )
           then c.scope||'m' else c.scope end),
    c.types_ar,
    case when c.scope2 is null then null else public.ops_qa_scope_tables(c.scope2) end,
    case when c.scope2 is null then null else c.types_ar end,
    p_deal, p_period, c.macro, p_cities, p_districts, p_region_ids,
    p_amin, p_amax, p_beds, p_bmin, p_pmin, p_pmax) d
  where c.ui_type = p_ui_type
$function$;

-- Barrier: the oracle's combined-mode scope must equal the scope the client actually sends.
-- Executable, not a source-text match: it recomputes the differential with the scope the client
-- harvests and asserts ops_qa_diff already agrees. Deliberately cheap (two Residential cohorts,
-- ~4 index scans) because mon_run_all_detectors is already being killed on budget some sweeps.
create or replace function public.mon_detect_qa_oracle_combined_scope()
returns integer
language plpgsql
as $function$
declare
  v_bad jsonb := '[]'::jsonb;
  v_raised int := 0;
  r record;
begin
  for r in
    select c.ui_type,
           (select n from public.ops_qa_diff(c.ui_type, null, null, array['الرياض'], null,
                                             array[1], null,null,null,null,null,null)) as via_diff,
           (select d.n from public.ops_qa_search_differential(
              public.ops_qa_scope_tables(c.scope||'m'), c.types_ar,
              case when c.scope2 is null then null else public.ops_qa_scope_tables(c.scope2) end,
              case when c.scope2 is null then null else c.types_ar end,
              null, null, c.macro, array['الرياض'], null, array[1],
              null,null,null,null,null,null) d) as via_client_scope
    from public.ops_qa_cohort c
    where c.macro = 'Residential' and c.ui_type in ('شقة','غرفة')
  loop
    if r.via_diff is distinct from r.via_client_scope then
      v_bad := v_bad || jsonb_build_object('ui_type', r.ui_type,
                 'oracle', r.via_diff, 'client_scope', r.via_client_scope);
    end if;
  end loop;

  if jsonb_array_length(v_bad) > 0 then
    v_raised := public.mon_raise('P2', 'qa_oracle_scope_contract', 'all',
      'qa_oracle_combined_scope',
      jsonb_build_object(
        'why', 'Buy+Rent COMBINED mode (owner 2026-08-20) has no period selector, so the client '
            || 'sends deal NULL + period NULL and its Rent side spans BOTH periods - it therefore '
            || 'searches the monthly-inclusive table scope (33 tables for a Residential cohort, '
            || 'never 31). An oracle on the narrower scope under-counts by exactly the monthly-only '
            || 'sources and stamps correct product behaviour COUNT_MISMATCH.',
        'mismatches', v_bad,
        'action', 'Fix the scope branch in public.ops_qa_diff. Do NOT "fix" this by relaxing the '
               || 'adjudicator: the product is right and the oracle must match the harvested '
               || 'request (§41.6), never the other way round.'));
  else
    perform public.mon_resolve_key('qa_oracle_scope_contract', 'qa_oracle_combined_scope');
  end if;
  return v_raised;
end $function$;

-- Roster wiring in the SAME migration, guarded needle-splice (§38: never re-paste the whole body).
do $do$
declare
  src text; before_n int; after_n int;
  anchor text := '''mon_detect_orphaned_detectors''';
  needle text := ', ''mon_detect_qa_oracle_combined_scope''';
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to wire blindly';
  end if;
  if position('mon_detect_qa_oracle_combined_scope' in src) > 0 then
    raise notice 'already wired - no-op'; return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1 - refusing to splice',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  before_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  src := replace(src, anchor, anchor || needle);
  after_n := (length(src) - length(replace(src, '''mon_detect_', ''))) / length('''mon_detect_');
  if after_n <> before_n + 1 then
    raise exception 'roster went from % to % entries, expected exactly +1 - refusing to install',
      before_n, after_n;
  end if;
  if position('mon_detect_qa_oracle_combined_scope' in src) = 0
     or position('mon_detect_qa_adjudicator_zero_contract' in src) = 0
     or position('mon_detect_orphaned_detectors' in src) = 0
     or position('mon_detect_card_label_contract' in src) = 0 then
    raise exception 'post-splice assertion failed - refusing to install';
  end if;
  execute src;
end
$do$;
