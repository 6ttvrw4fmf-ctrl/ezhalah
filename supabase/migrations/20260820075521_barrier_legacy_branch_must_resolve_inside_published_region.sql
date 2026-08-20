-- Barrier for the bug class fixed by 20260820_v1_legacy_city_resolution_scoped_to_published_region
-- (Data Integrity run #33): listing_native_location_v1's `legacy` branch resolved a city NAME
-- against loc_catalog_city with no region predicate, so a name repeating across regions
-- (الهفوف / المجمعة / القويعية / الباحة / البدائع / بيش / تربة ...) was picked ARBITRARILY by an
-- untiebroken DISTINCT ON. 810 listings sat in a region their own source contradicted.
--
-- This guards the INVARIANT, not today's example: whenever listings_arabic_locations has matched a
-- city AND a region, and that city name resolves to exactly ONE catalog city inside that region,
-- the legacy branch must return precisely that city. A standing 0 is the healthy reading (24c) --
-- it is a regression guard on the region-scoped lateral, and it must never be "tidied away".
--
-- SCOPE IS DELIBERATE. It asks only about rows the legacy branch actually serves
-- (source_method = 'legacy_derived'). It is NOT a general "city disagrees with region" detector:
--   * rows served by a priority-1 branch legitimately prefer the platform's own city over the
--     lal overlay, so folding them in re-creates the run #19 measurement trap (333 of 341 such
--     "defects" were the measurement, not the data);
--   * 7 wasalt rows whose SOURCE contradicts itself -- it publishes region name "Riyadh" and
--     region_id 3 (منطقة المدينة المنورة) on the same listing -- are a source limitation, not an
--     Ezhalah defect, and a barrier that can never go green would mask re-occurrence via the
--     mon_raise dedup rule (23a/25a).
--
-- Raise and resolve share ONE predicate and run on the evaluated path only (25a).
create or replace function public.mon_detect_legacy_branch_region_scope()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int := 0; total int := 0; sample jsonb := '[]'::jsonb;
begin
  select count(*), coalesce(jsonb_agg(x order by x->>'listing_id'), '[]'::jsonb)
    into total, sample
  from (
    select jsonb_build_object(
             'platform', v.platform, 'source_table', v.source_table, 'listing_id', v.listing_id,
             'city_ar', l.city_ar, 'published_region', l.region_ar,
             'resolved_city_id', v.city_id, 'expected_city_id', k.cid) as x
    from public.listing_native_location_v1 v
    join public.listings_arabic_locations l
      on l.platform = v.platform and l.listing_id = v.listing_id
    join public.loc_catalog_region rl
      on normalize_ar(rl.region_ar) = normalize_ar(l.region_ar)
    cross join lateral (
      select min(c2.city_id) as cid, count(distinct c2.city_id) as n
      from public.loc_catalog_city c2
      where c2.city_norm = normalize_ar(l.city_ar) and c2.region_id = rl.region_id) k
    where v.source_method = 'legacy_derived'
      and l.matched and l.city_ar is not null and l.region_ar is not null
      and k.n = 1
      and v.city_id is distinct from k.cid
    limit 25
  ) s;

  if total > 0 then
    n := public.mon_raise('P1', 'legacy_branch_region_scope', 'all', 'legacy_branch_region_scope',
      jsonb_build_object(
        'count', total,
        'sample', sample,
        'why', 'listing_native_location_v1''s legacy branch returned a city OTHER than the single '
               'catalog city that exists inside the region listings_arabic_locations already matched. '
               'That is the run #33 defect returning: the region-scoped lateral (lsc) has been dropped, '
               'reordered behind the unscoped fallback (lgc), or the COALESCE precedence was inverted.',
        'do_not', 'Do NOT repair rows to make this green, and do NOT relax count(distinct city_id)=1. '
                  'The defect is in the view; the rows are its output. A name ambiguous even inside its '
                  'own published region must keep falling through to the deterministic fallback.'));
  else
    perform public.mon_resolve_key('legacy_branch_region_scope', 'legacy_branch_region_scope');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_legacy_branch_region_scope() is
  'Run #33 regression guard. Measured cost ~1.5 s. Healthy reading is 0 and must stay 0 (24c): it '
  'proves listing_native_location_v1''s legacy branch still resolves a city inside the region the '
  'source published, rather than picking a same-named city in another region at random.';

-- GUARDED NEEDLE-EDIT of the roster (per 20260810222259): read the LIVE body, splice ONE entry.
-- A wholesale CREATE OR REPLACE silently drops every entry the author's copy predated.
do $$
declare
  v_def text; v_before text;
  anchor constant text := '''mon_detect_orphaned_detectors''';
  add    constant text := 'mon_detect_legacy_branch_region_scope';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing - refusing to guess at the array shape';
  end if;
  if position('''' || add || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, anchor || ', ''' || add || '''');
  end if;
  if v_def = v_before then
    raise notice 'roster already carries % - nothing to do', add;
    return;
  end if;
  execute v_def;
end $$;

-- Prove in the same transaction: new entry reachable AND pre-existing controls survived.
do $$
declare
  v_def text; fn text; missing text[] := '{}';
  want text[] := array[
    'mon_detect_legacy_branch_region_scope',
    -- CONTROLS: entries that existed before this migration and must not have been lost by it.
    'mon_detect_silent_scraper_death','mon_detect_zero_new_stall',
    'mon_detect_english_overlay_stranded_city','mon_detect_orphaned_detectors',
    'mon_detect_run_log_timestamps_inverted','mon_detect_cron_ordering_contract'
  ];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster edit incomplete or dropped entries: %', array_to_string(missing, ', ');
  end if;
  if position('open_alerts' in v_def) = 0 then
    raise exception 'roster return can no longer report standing alerts';
  end if;
end $$;
