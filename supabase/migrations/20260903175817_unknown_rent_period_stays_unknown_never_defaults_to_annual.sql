-- SOURCE IS TRUTH for the rental PERIOD (owner rule, restated 2026-09-03: "Never infer Monthly or
-- Yearly when the source does not explicitly support it").
--
-- THE DEFECT. sync_search_listings_ar derived the searchable period as:
--     case v.rent_period when 'monthly' then 'شهري' when 'annual' then 'سنوي'
--          else case when v.platform in ('gathern','aqarmonthly') then 'شهري' else 'سنوي' end end
-- so a rental whose SOURCE PUBLISHES NO PERIOD was written into the search index as 'سنوي'
-- (yearly). That is a manufactured value: it makes the row match a STRICT yearly filter it has no
-- evidence for, which is exactly the "missing must never become a value" rule.
--
-- MEASURED SCOPE at the time of this change: 905 active rentals across 20 platforms publish no
-- period and were all labelled yearly — aqar 407, raghdan 125, eaqartabuk 111, arkaan 76, dealapp
-- 49, eastabha 37, alkhaas 23, abralosol 21, mustqr 10, souq24 8, mizlaj/sadin/hajer 6 each,
-- aouj 5, abeea/october/aldarim/ramzalqasim 3 each, alhoshan/jurash 1 each. 803 of those are
-- pre-existing inventory; the defect long predates the platforms added today, which merely
-- surfaced it.
--
-- THE FIX. The unknown case now yields NULL for every platform EXCEPT gathern and aqarmonthly.
-- Those two keep 'شهري' because that is not an inference: both are monthly-only verticals by
-- documented platform rule (ARCHITECTURE §17, MONTHLY_ONLY_TABLE in src/data/remote.ts), so the
-- period is known from the platform itself rather than guessed from the row.
--
-- WHY NO LISTING IS LOST. location_search_candidates_ar treats a NULL period as "not in either
-- bucket", never as "not searchable": with no period filter the row still returns (the p_rent_period
-- IS NULL branch), and it is correctly excluded from strict شهري / سنوي / كلاهما, which is the
-- owner's stated requirement. Verified before applying: annual (22,447) + monthly (9,422) = the
-- full unfiltered rent set (31,869) in Riyadh today, so the affected rows move OUT of the yearly
-- bucket while remaining in the unfiltered set.
DO $do$
DECLARE
  src text;
  fixed text;
  hits int;
BEGIN
  src := pg_get_functiondef('public.sync_search_listings_ar()'::regprocedure);

  -- Snapshot the exact pre-change definition so this is trivially reversible.
  INSERT INTO public.ops_ddl_snapshot (label, obj_schema, obj_name, obj_kind, ordinal, ddl)
  VALUES ('pre_rent_period_unknown_fix_20260903', 'public', 'sync_search_listings_ar', 'function', 0, src);

  fixed := replace(src,
    'then ''شهري'' else ''سنوي'' end end',
    'then ''شهري'' else null::text end end');

  hits := (length(src) - length(replace(src, 'then ''شهري'' else ''سنوي'' end end', ''))) 
          / length('then ''شهري'' else ''سنوي'' end end');
  IF hits <> 2 THEN
    RAISE EXCEPTION 'expected exactly 2 occurrences of the period default, found % — aborting', hits;
  END IF;

  EXECUTE fixed;
END
$do$;

select 'applied' as status,
       (select count(*) from public.ops_ddl_snapshot where label='pre_rent_period_unknown_fix_20260903') as rollback_rows;
