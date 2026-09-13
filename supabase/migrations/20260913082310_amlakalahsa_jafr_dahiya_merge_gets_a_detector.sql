-- Companion detector for amlakalahsa_jafr_dahiya_districts_merged_to_one /
-- jafr_hajar_ordinal_catalog_seeds_removed / amlakalahsa_jafr_dahiya_search_index_backfill (owner
-- instruction 2026-09-13: collapse الجفر's 9 numbered "ضاحية هجر" sub-plots to one match district
-- "الضاحية"). The scraper itself was also fixed to apply this collapse on every future scrape
-- (scrapers/amlakalahsa/run.py), so a regression here would mean either that scraper fix got
-- reverted, or a future edit to listing_native_location_v1/search_listings_ar's sync path stopped
-- propagating it — this watches BOTH the base table and the search index directly, independent of
-- which layer would have broken.
CREATE OR REPLACE FUNCTION public.mon_detect_amlakalahsa_jafr_dahiya_merge_regressed()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0;
  v_base_unmerged int;
  v_index_unmerged int;
  v_base_merged int;
begin
  -- (A) the base table: no الجفر row should carry a numbered "الضاحية <suffix>" value anymore —
  -- every one of them must have collapsed to the bare "الضاحية".
  select count(*) into v_base_unmerged
  from public.amlakalahsa_residential_listings
  where active and city_ar = 'الجفر' and district_ar like 'الضاحية%' and district_ar <> 'الضاحية';

  if v_base_unmerged > 0 then
    n := n + public.mon_raise('P2', 'amlakalahsa_jafr_dahiya_merge_regressed', 'amlakalahsa',
      'amlakalahsa_jafr_dahiya_merge_regressed:base_table',
      jsonb_build_object('unmerged', v_base_unmerged,
        'why', v_base_unmerged || ' active الجفر row(s) carry a numbered "الضاحية <suffix>" '
            || 'district_ar again — scrapers/amlakalahsa/run.py''s city-scoped collapse '
            || '(city_ar==''الجفر'' and district_ar startswith ''الضاحية'') may have been reverted. '
            || 'See migration 20260913080703_amlakalahsa_jafr_dahiya_districts_merged_to_one.sql.'));
  else
    perform public.mon_resolve_key('amlakalahsa_jafr_dahiya_merge_regressed', 'amlakalahsa_jafr_dahiya_merge_regressed:base_table');
  end if;

  -- (B) the search index must agree with the base table — a sync path that stopped propagating
  -- the merge would leave amlakalahsa's own base rows correct but every actual SEARCH wrong.
  select count(*) into v_index_unmerged
  from public.search_listings_ar
  where city_ar = 'الجفر' and source_table = 'amlakalahsa_residential_listings'
    and district_ar like 'الضاحية%' and district_ar <> 'الضاحية';

  if v_index_unmerged > 0 then
    n := n + public.mon_raise('P2', 'amlakalahsa_jafr_dahiya_merge_regressed', 'amlakalahsa',
      'amlakalahsa_jafr_dahiya_merge_regressed:search_index',
      jsonb_build_object('unmerged', v_index_unmerged,
        'why', v_index_unmerged || ' search_listings_ar row(s) for amlakalahsa/الجفر carry a '
            || 'numbered "الضاحية <suffix>" again while the base table may still be correct — the '
            || 'sync path (listing_native_location_v1 -> v2 -> sync_search_listings_ar) stopped '
            || 'propagating the merge. See migration '
            || '20260913081200_amlakalahsa_jafr_dahiya_search_index_backfill.sql.'));
  else
    perform public.mon_resolve_key('amlakalahsa_jafr_dahiya_merge_regressed', 'amlakalahsa_jafr_dahiya_merge_regressed:search_index');
  end if;

  -- (C) sanity floor — the merged district must still have a healthy population, not have
  -- silently emptied out (e.g. every row got deactivated, or district_ar got blanked instead of
  -- merged). 32 were merged on 2026-09-13; never expected to shrink, only grow as new listings
  -- in this development are scraped.
  select count(*) into v_base_merged
  from public.amlakalahsa_residential_listings
  where active and city_ar = 'الجفر' and district_ar = 'الضاحية';

  if v_base_merged < 32 then
    n := n + public.mon_raise('P2', 'amlakalahsa_jafr_dahiya_merge_regressed', 'amlakalahsa',
      'amlakalahsa_jafr_dahiya_merge_regressed:population_floor',
      jsonb_build_object('count', v_base_merged,
        'why', 'only ' || v_base_merged || ' active الجفر row(s) carry district_ar=''الضاحية'' — '
            || 'started at 32 on 2026-09-13 and should never shrink. Check whether rows were '
            || 'deactivated, or district_ar was blanked/changed instead of staying merged.'));
  else
    perform public.mon_resolve_key('amlakalahsa_jafr_dahiya_merge_regressed', 'amlakalahsa_jafr_dahiya_merge_regressed:population_floor');
  end if;

  return n;
end $function$;

-- Needle-edit into the mon_run_all_detectors() roster: anchor on the exact live tail text so a
-- concurrent session's own roster addition fails LOUDLY instead of being silently clobbered by a
-- hand-retyped full function body.
do $mig$
declare
  src text;
  new_src text;
begin
  select pg_get_functiondef('mon_run_all_detectors'::regproc) into src;
  new_src := replace(src,
    $q$'mon_detect_amlakalahsa_soum_price_regressed'
  ];$q$,
    $q$'mon_detect_amlakalahsa_soum_price_regressed',
    'mon_detect_amlakalahsa_jafr_dahiya_merge_regressed'
  ];$q$);
  if new_src = src then
    raise exception 'mon_run_all_detectors roster tail changed shape — needle not found, aborting rather than guessing';
  end if;
  execute new_src;
end $mig$;

-- Prove it green in-migration: the merge just ran, so all three checks must be clean right now.
do $verify$
declare
  raised int;
begin
  select public.mon_detect_amlakalahsa_jafr_dahiya_merge_regressed() into raised;
  if raised <> 0 then
    raise exception 'mon_detect_amlakalahsa_jafr_dahiya_merge_regressed raised % alert(s) immediately after the merge it watches', raised;
  end if;
end $verify$;