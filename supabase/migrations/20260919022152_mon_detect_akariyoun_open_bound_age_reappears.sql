-- Guards the repair in 20260919014358_akariyoun_open_bound_ages_are_unknown_not_ten.sql.
--
-- That repair NULLed property_age on 46 عقاريون listings whose «عمر العقار» reads
-- «اكثر من عشر سنوات» — MORE THAN ten years — and which Ezhalah had stored as exactly 10. The 17
-- rows whose source genuinely says «عشر سنوات» were left at 10.
--
-- The repair is not self-defending. scrapers/akariyoun/run.py now returns None for an open bound,
-- but _unknown_must_not_overwrite_known() DROPS a None key from an upsert (owner rule 2026-08-09),
-- so the scraper can never re-NULL a row it once got wrong. Anything that writes a number onto
-- these 46 URLs — a parser regression, a hand-edit, a restored backup — therefore sticks silently
-- and puts a manufactured age back in front of customers filtering «10 years or newer».
--
-- So the detector watches the 46 proven URLs by name. Each one was re-fetched from its own listing
-- page on 2026-09-19 and read individually; this is per-row evidence, not a class inference. A
-- non-null age on any of them means either a regression or a genuine source change, and both need
-- a human to look — P2, visible, never auto-corrected.
-- The proven-open-bound URL set, kept in one place so the detector and any future repair cannot
-- drift apart. Changing this list requires quoting the listing's live «عمر العقار» text.
create or replace function public.akariyoun_open_bound_age_slugs()
returns text[] language sql immutable set search_path to 'public' as $slugs$
  select array[
'aamar-llaygar-fy-hy-almsfa','aamar-llbyaa-fy-hy-alaaard','aamar-llbyaa-fy-hy-alghnamy',
'aamar-llbyaa-fy-hy-bdr','astrah-llbyaa-fy-alaaoaly','astrah-llbyaa-fy-hy-alaaard',
'dor-llaygar-fy-alyasmyn','dor-llaygar-fy-hy-almlka','dor-llaygar-fy-hy-alshaf-4',
'dor-llaygar-fy-hy-alshaf-8','dor-llaygar-fy-hy-alyasmyn','dor-llaygar-fy-hy-alyasmyn-4',
'fyla-llaygar-fy-hy-almlk-fysl','fyla-llaygar-fy-hy-almlka','fyla-llaygar-fy-hy-alnrgs',
'fyla-llaygar-fy-hy-alshaf-4','fyla-llbyaa-fy-alyasmyn','fyla-llbyaa-fy-hy-alaaoaly',
'fyla-llbyaa-fy-hy-almhmdy-2','fyla-llbyaa-fy-hy-almsyf','fyla-llbyaa-fy-hy-alnrgs',
'fyla-llbyaa-fy-hy-alshaf','fyla-llbyaa-fy-hy-alshaf-12','fyla-llbyaa-fy-hy-alshaf-16',
'fyla-llbyaa-fy-hy-alshaf-4','fyla-llbyaa-fy-hy-alshfaaa','fyla-llbyaa-fy-hy-alyasmyn-2',
'fyla-llbyaa-fy-hy-alyasmyn-4','fyla-llbyaa-fy-hy-krtb','ghrf-llaygar-fy-hy-alyasmyn-4',
'shk-llaygar-fy-hy-alaaard-12','shk-llaygar-fy-hy-alaakyk','shk-llaygar-fy-hy-alaakyk-2',
'shk-llaygar-fy-hy-alandls','shk-llaygar-fy-hy-almlka-10','shk-llaygar-fy-hy-alnzh',
'shk-llaygar-fy-hy-aloady-2','shk-llaygar-fy-hy-alshaf-1','shk-llaygar-fy-hy-alshaf-8',
'shk-llaygar-fy-hy-alyasmyn-26','shk-llaygar-fy-hy-alyasmyn-8','shk-llaygar-fy-hy-ghrnat',
'shk-llaygar-fy-hy-krtb','shk-llbyaa-fy-hy-aloady','shqwa-at-sgyr-at-stwdyw-llyjr-fy-hy-lmrslt',
'shqwa-at-sgyr-at-stwdyw-llyjr-fy-hy-lshf-at']::text[];
$slugs$;

create or replace function public.mon_detect_akariyoun_open_bound_age_reappears()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; v_rows jsonb; v_n bigint; v_open text;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'listing_url', listing_url, 'property_age', property_age) order by listing_url), '[]'::jsonb),
         count(*)
    into v_rows, v_n
    from public.akariyoun_residential_listings
   where active
     and property_age is not null
     and replace(listing_url, 'https://akariyoun.sa/properties/', '') = any (
           public.akariyoun_open_bound_age_slugs());

  select severity into v_open from public.alert_event
   where dedup_key = 'akariyoun_open_bound_age_reappears' and resolved_at is null
   order by created_at desc limit 1;

  if v_n = 0 then
    if v_open is not null then
      perform public.mon_resolve_key('akariyoun_open_bound_age_reappears',
                                     'akariyoun_open_bound_age_reappears');
    end if;
    return 0;
  end if;

  n := public.mon_raise('P2', 'akariyoun_open_bound_age_reappears', 'akariyoun',
    'akariyoun_open_bound_age_reappears',
    jsonb_build_object(
      'rows_with_age', v_n,
      'listings', v_rows,
      'why', 'These عقاريون listings were read individually from their own pages on 2026-09-19 and '
          || 'their «عمر العقار» says «اكثر من عشر سنوات» — MORE THAN ten years, an OPEN BOUND with '
          || 'no upper limit. 20260919014358 set their property_age to NULL because storing 10 '
          || 'invents a precision the source withheld (and 11 invents a different one). A number '
          || 'here means that repair has been undone.',
      'adjudicate', 'Do NOT simply re-run the repair. Re-fetch the listing URL and read «عمر '
          || 'العقار» first. If it still reads «اكثر من …», this is a regression — find what wrote '
          || 'the number (parse_age() in scrapers/akariyoun/run.py returns None for an open bound; '
          || 'note that _unknown_must_not_overwrite_known drops that None, so the scraper cannot '
          || 'self-heal and an explicit UPDATE is needed). If the seller has since published a '
          || 'CONCRETE age, the number is correct: drop that URL from '
          || 'akariyoun_open_bound_age_slugs() with the new source text quoted in the migration.'));
  return n;
end
$function$;


-- RE-ASSERT the repair idempotently, so this file carries both the fix and its guard.
update public.akariyoun_residential_listings
   set property_age = NULL
 where active
   and property_age is not null
   and replace(listing_url, 'https://akariyoun.sa/properties/', '')
       = any (public.akariyoun_open_bound_age_slugs());

do $roster$
declare d text;
begin
  d := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_akariyoun_open_bound_age_reappears' in d) > 0 then
    return;                                   -- already rostered
  end if;
  if position($anchor$'mon_detect_dead_qa_oracle_wrapper'$anchor$ in d) = 0 then
    raise exception 'mon_run_all_detectors roster anchor not found — add '
                    'mon_detect_akariyoun_open_bound_age_reappears to the roster explicitly';
  end if;
  d := replace(d,
        $anchor$'mon_detect_dead_qa_oracle_wrapper'$anchor$,
        $anchor$'mon_detect_dead_qa_oracle_wrapper',
    'mon_detect_akariyoun_open_bound_age_reappears'$anchor$);
  execute d;
end $roster$;

do $verify$
declare v_raised int; v_rostered boolean;
begin
  -- MUTATION PROOF: plant a number on a known open-bound row, the detector must SEE it.
  update public.akariyoun_residential_listings set property_age = 10
   where active and replace(listing_url, 'https://akariyoun.sa/properties/', '')
                    = 'dor-llaygar-fy-alyasmyn';
  if (select count(*) from public.akariyoun_residential_listings
       where active and property_age is not null
         and replace(listing_url,'https://akariyoun.sa/properties/','') = 'dor-llaygar-fy-alyasmyn') = 1 then
    v_raised := public.mon_detect_akariyoun_open_bound_age_reappears();
    if v_raised < 1 then
      raise exception 'detector did not fire on a planted open-bound age — it guards nothing';
    end if;
  end if;
  -- undo the mutation and resolve the alert it raised
  update public.akariyoun_residential_listings set property_age = NULL
   where active and replace(listing_url, 'https://akariyoun.sa/properties/', '')
                    = 'dor-llaygar-fy-alyasmyn';

  -- and now it must be GREEN on the real data
  v_raised := public.mon_detect_akariyoun_open_bound_age_reappears();
  if v_raised <> 0 then
    raise exception 'detector raised % on clean data', v_raised;
  end if;

  v_rostered := position('mon_detect_akariyoun_open_bound_age_reappears'
                 in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) > 0;
  if not v_rostered then
    raise exception 'detector is not on the mon_run_all_detectors roster';
  end if;
  raise notice 'mon_detect_akariyoun_open_bound_age_reappears: rostered, mutation-proved, green';
end $verify$;
