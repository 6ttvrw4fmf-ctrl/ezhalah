-- REPAIR: 46 عقاريون listings carried property_age = 10 for a source that says «اكثر من عشر سنوات»
-- — MORE THAN ten years. Ezhalah created this error, which is the only condition under which
-- docs/ops/DATA_INTEGRITY_ENGINEER.md permits touching captured data.
--
-- EVIDENCE, per row, not inferred. All 63 rows stored as age=10 were re-fetched from their own
-- listing URLs on 2026-09-19 and their «عمر العقار» text read directly:
--     46  «اكثر من عشر سنوات»   -> an OPEN BOUND, repaired to NULL here
--     17  «عشر سنوات»           -> genuinely ten, LEFT ALONE
-- The 17 are named nowhere below precisely because they are correct; only the 46 are touched.
--
-- WHY NULL AND NOT 11. «More than ten» has no upper bound, so 10 invents a precision the source
-- withheld and 11 invents a different one. NULL is the tri-state's honest answer and the Advanced
-- Filter already renders it as «لم يذكر» — SOURCE IS TRUTH, silent/unbounded -> NULL.
--
-- WHY A MIGRATION AND NOT THE SCRAPER. scrapers/akariyoun/run.py now returns None for an open
-- bound, but _unknown_must_not_overwrite_known() deliberately DROPS a None key from an upsert so a
-- failed fetch can never erase a stored value (owner rule 2026-08-09). That guard is right and
-- stays; it simply cannot tell "did not read" from "read, and the source is unbounded". So the
-- already-stored wrong values need this one explicit repair. New captures are correct without it.
update public.akariyoun_residential_listings
   set property_age = NULL
 where active
   and property_age = 10
   and replace(listing_url, 'https://akariyoun.sa/properties/', '') in (
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
'shqwa-at-sgyr-at-stwdyw-llyjr-fy-hy-lshf-at');

do $verify$
declare v_ten int; v_total int;
begin
  select count(*) into v_ten from public.akariyoun_residential_listings
   where active and property_age = 10;
  if v_ten <> 17 then
    raise exception 'expected exactly the 17 source-confirmed «عشر سنوات» rows to remain at 10, found %', v_ten;
  end if;
  select count(*) into v_total from public.akariyoun_residential_listings
   where active and property_age is not null;
  raise notice 'akariyoun ages after repair: % stated, 17 of them exactly ten', v_total;
end $verify$;