-- PERMANENT BARRIER for the fix in 20260903175817: an UNKNOWN rental period must stay UNKNOWN.
--
-- The fixed defect: sync_search_listings_ar wrote 'سنوي' (yearly) into the searchable index for any
-- rental whose SOURCE published no period — 905 rows across 20 platforms at the time. Such a row
-- then matched a STRICT yearly filter it had no evidence for. Owner rule, restated 2026-09-03:
-- "Never infer Monthly or Yearly when the source does not explicitly support it."
--
-- This detector asserts the INVARIANT rather than the implementation, so it keeps working if the
-- sync is rewritten: for every searchable rental, a period in the index must be backed by a period
-- at the source. gathern and aqarmonthly are the ONLY legitimate exceptions, and not by inference —
-- both are monthly-only verticals by documented platform rule (ARCHITECTURE §17), so their period
-- is known from the platform itself.
create or replace function public.mon_detect_rent_period_inferred_when_source_silent()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inferred bigint; v_wrong_value bigint; n int := 0; bad jsonb := '[]'::jsonb;
begin
  -- 1. THE CORE INVARIANT: index says a period, source says nothing.
  select count(*) into v_inferred
  from search_listings_ar s
  join listing_native_location_v2 v
    on v.source_table = s.source_table and v.listing_id = s.listing_id
  where s.deal_ar = 'إيجار'
    and s.rent_period_ar is not null
    and v.rent_period is null
    and s.platform not in ('gathern','aqarmonthly');

  -- 2. The index must never carry a period token outside the source vocabulary.
  select count(*) into v_wrong_value
  from search_listings_ar
  where rent_period_ar is not null and rent_period_ar not in ('شهري','سنوي');

  if v_inferred > 0 then
    bad := bad || jsonb_build_object('kind','period_inferred_from_silence','rows',v_inferred,
      'why','These rentals publish NO period at source but carry one in the search index, so they '
         || 'match a strict شهري/سنوي filter on manufactured evidence. Fix the sync to emit NULL — '
         || 'never widen the filter to hide it.');
  end if;
  if v_wrong_value > 0 then
    bad := bad || jsonb_build_object('kind','period_token_outside_vocabulary','rows',v_wrong_value);
  end if;

  if jsonb_array_length(bad) > 0 then
    n := public.mon_raise('P1','rent_period_source_truth','all','rent_period_inferred_when_silent',
      jsonb_build_object('failures', bad,
        'why','PERIOD = SOURCE. A rental whose source states no period is neither monthly nor '
           || 'yearly: it stays searchable as Rent and is excluded from both strict period '
           || 'filters. Only gathern/aqarmonthly may carry a period without a row-level source '
           || 'value, because those platforms are monthly-only by documented rule.'));
  else
    perform public.mon_resolve_key('rent_period_source_truth','rent_period_inferred_when_silent');
  end if;
  return n;
end $function$;

-- Roster entry in the SAME migration (AGENTS.md): a detector nothing reaches is decoration, and
-- mon_detect_orphaned_detectors fires on it.
DO $do$
DECLARE src text; fixed text;
BEGIN
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  IF position('mon_detect_rent_period_inferred_when_source_silent' in src) > 0 THEN
    RAISE NOTICE 'already in roster'; RETURN;
  END IF;
  fixed := replace(src,
    '''mon_detect_enumeration_incomplete''',
    '''mon_detect_rent_period_inferred_when_source_silent'',
    ''mon_detect_enumeration_incomplete''');
  IF fixed = src THEN
    RAISE EXCEPTION 'roster anchor not found — refusing to add a detector nothing calls';
  END IF;
  EXECUTE fixed;
END
$do$;

select public.mon_detect_rent_period_inferred_when_source_silent() as raised_now,
       (position('mon_detect_rent_period_inferred_when_source_silent'
                 in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) > 0) as in_roster;
