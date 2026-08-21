-- Correction to 20260821154150_barrier_phasea_offregion_pick.sql, made in the same run that wrote it.
--
-- As first written, limb (a) replicated the FIXED candidate ordering and then asserted that the
-- fixed ordering produces an in-region pick. That is a tautology: pub_pref=0 candidates sort first,
-- so a candidate inside the published region is ALWAYS chosen when one exists, and the limb is
-- structurally incapable of firing. It is the rule 11a failure - a barrier nothing can fail is
-- decoration - and it is the same shape as rule 25a: two phrasings of "is it still broken?" that
-- cannot disagree, here because both phrasings were the same code.
--
-- The faithful question is not "would the current ordering pick correctly?" but "what did the
-- resolver ACTUALLY store?". So limb (a) now reads listing_native_location_v2 - the resolver's own
-- output - and asserts no row sits in a region its platform contradicts while a city of that name
-- exists inside the published one. That is the user-visible condition, and it is falsifiable: it
-- reads 11 right now, before the hourly listing_native_location_v1 refresh has carried the fix
-- through, and must read 0 after it.
--
-- v2 is the RESOLVER's clock (v1, jobid 17, hourly at :00), not a downstream consumer's, so this
-- does not repeat the rule 24b mistake of keying a cohort on sync-search-listings-ar's timing. A row
-- can sit in this cohort for at most one resolver cycle after a legitimate change; that is the
-- resolver's own latency, not a schedule the detector has no business measuring.
--
-- Measured cost 2026-08-21: 10,324 ms (v2 join) against 3,963 ms for the tautological form and
-- 50,202 ms for reading phasea_shadow_resolution directly. 10 s is affordable in a 30-minute roster;
-- 50 s inside a 60 s budget is the rule 23a detector_crash failure mode.
create or replace function public.mon_detect_phasea_offregion_pick()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; total int := 0; sample jsonb := '[]'::jsonb; viewdef text; pinned boolean;
begin
  -- limb (b): structural pin - the live view must still carry the region-scoped ordering term.
  select pg_get_viewdef('public.phasea_shadow_resolution'::regclass, true) into viewdef;
  pinned := viewdef like '%pub_region_id%';

  -- limb (a): behavioural - what the resolver actually stored, over the at-risk cohort only.
  with dup as (
    select city_norm from loc_catalog_city group by city_norm having count(*) > 1
  ), risk as (
    select mv.source_table, mv.listing_id, mv.region_raw, s.city_ar_src,
           normalize_ar(coalesce(mv.city, s.city_ar_src)) as nkey,
           (select cr.region_id from loc_region_map rm
              join loc_catalog_region cr on cr.region_ar = rm.region_ar
             where rm.region_key = lower(btrim(mv.region_raw))) as pub_region_id
    from listing_location_canonical_mv mv
    left join phasea_src_arabic s
           on s.source_table = mv.source_table and s.listing_id = mv.listing_id
    join dup on dup.city_norm = normalize_ar(coalesce(mv.city, s.city_ar_src))
    where mv.source_table ~ '_(residential|commercial)_listings$'
      and mv.source_table !~ '^(aqar|alhoshan|aldarim|aqarmonthly|aqargate|sanadak|hajer|wasalt|souq24)_'
  )
  select count(*), coalesce(jsonb_agg(x order by x->>'source_table', (x->>'listing_id')::bigint), '[]'::jsonb)
    into total, sample
  from (
    select jsonb_build_object(
             'source_table', r.source_table, 'listing_id', r.listing_id,
             'city_ar_src', r.city_ar_src, 'published_region', r.region_raw,
             'published_region_id', r.pub_region_id,
             'stored_city_id', v.city_id, 'stored_region_id', v.region_id) as x
    from risk r
    join listing_native_location_v2 v
      on v.source_table = r.source_table and v.listing_id = r.listing_id
    where r.pub_region_id is not null
      and v.region_id is distinct from r.pub_region_id
      and exists (select 1 from loc_catalog_city c
                   where c.region_id = r.pub_region_id and c.city_norm = r.nkey)
    limit 25
  ) q;

  if total > 0 or not pinned then
    n := public.mon_raise('P1', 'phasea_offregion_pick', 'all', 'phasea_offregion_pick',
      jsonb_build_object(
        'count', total,
        'ordering_pinned', pinned,
        'sample', sample,
        'why', 'A phasea-resolved listing is STORED in a region the platform itself contradicts, '
               'while a city of that name exists inside the published region - or the view no longer '
               'carries the region-scoped ordering term at all (ordering_pinned=false). Saudi place '
               'names repeat across regions legitimately, so a candidate list with no region '
               'predicate ties and LIMIT 1 returns an arbitrary row that can change between '
               'rebuilds. 11 listings were served in a contradicted region this way until 2026-08-21 '
               '(aqarcity 10, ramzalqasim 1), source-verified live against aqarcity''s schema.org '
               'addressRegion on 10/10 probed pages.',
        'do_not', 'Do NOT satisfy this by preferring listing_location_canonical_mv.region - that is '
                  'derived from loc_city_map keyed on the city NAME with no region predicate, so it '
                  'is circular and NULL for every source=unresolved row. Use region_raw, the '
                  'platform''s own published string. Do NOT widen this to aqar or wasalt: aqar''s '
                  'region column is the CRAWL FACET while the ad''s own title publishes its own '
                  'city+region, and wasalt publishes a region NAME and a region ID that contradict '
                  'each other - in both the SOURCE disagrees with itself and nothing is provably '
                  'Ezhalah''s. Do NOT resolve an ambiguity by guessing: a name ambiguous even inside '
                  'its published region keeps the deterministic city_id tiebreak. A single cycle of '
                  'this after a deliberate resolver change is v1''s refresh latency (jobid 17, :00), '
                  'not a defect - two consecutive cycles is real.'));
  else
    perform public.mon_resolve_key('phasea_offregion_pick', 'phasea_offregion_pick');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_phasea_offregion_pick() is
'Rule 24a guard at the phasea stage, reading the RESOLVER''S OUTPUT (listing_native_location_v2), not
a replay of phasea''s own ordering - the first version of this function replicated the fixed ordering
and was therefore structurally incapable of firing (rule 11a: a barrier nothing can fail is
decoration). Limb (b) pins the view definition so an edit to phasea cannot slip past limb (a).
Measured cost 2026-08-21: 10,324 ms (this form) vs 3,963 ms (tautological form) vs 50,202 ms (reading
phasea_shadow_resolution directly, which the planner refuses to push the restriction into). Read 10 s
as normal; 60 s+ is a real regression. Red-on-old / green-on-new was proven against the real pipeline
on 2026-08-21: 11 before the v1 refresh carried the fix through, 0 after.';
