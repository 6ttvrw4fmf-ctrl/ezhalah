-- Barrier for the bug class fixed this run: a phasea-resolved listing filed in a region its own
-- platform contradicts, while a city of that name exists inside the published region.
--
-- Rule 24a at a fifth stage. Two limbs, because a cheap cohort and a faithful cohort are different
-- claims (rule 25c):
--   (a) BEHAVIOURAL - replicate phasea's candidate ordering over the ONLY rows where a wrong pick is
--       possible (a city name carrying catalog duplicates: 1,553 of 48,720 phasea rows, 28 names)
--       and assert nothing lands outside the published region when a candidate exists inside it.
--   (b) STRUCTURAL PIN - assert phasea's live definition still carries the region-scoped term. Limb
--       (a) reads a COPY of the ordering, so without this pin an edit to the view would leave the
--       barrier passing against logic the view no longer runs.
--
-- Why a copy at all, measured rather than assumed (rule 24e): joining the real view costs
-- 50,202 ms - the planner materialises all 48,720 rows rather than pushing the restriction into the
-- lateral - against 3,963 ms for the replicated form. A 50 s detector inside a 60 s budget in a
-- 30-minute cron is the rule 23a failure mode exactly: it raises detector_crash and stops protecting
-- its class, which is worse than the bug. So limb (a) buys the speed and limb (b) buys back the
-- fidelity.
--
-- Cohort keys on listing_location_canonical_mv + phasea, never on search_listings_ar: rule 24b - a
-- cohort whose membership depends on the hourly sync's timing measures the schedule, not the defect.
--
-- Standing 0 is the healthy reading (rule 24c): after the fix the condition is unreachable by
-- construction, which makes this a regression guard on the ordering, not a live-traffic detector.
--
-- NOTE (2026-08-21): this migration's limb (a) was structurally tautological (it replicated the
-- FIXED ordering and asserted the fixed ordering picks correctly). Corrected in the same run by
-- 20260821154316_barrier_phasea_offregion_pick_reads_resolver_output.sql, which reads
-- listing_native_location_v2 (the resolver's own output) instead - proven red-on-old / green-on-new.
-- This file is kept as-is to preserve the applied history; the correction is the live definition.
create or replace function public.mon_detect_phasea_offregion_pick()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; total int := 0; sample jsonb := '[]'::jsonb; viewdef text; pinned boolean;
begin
  -- limb (b): structural pin on the live view definition
  select pg_get_viewdef('public.phasea_shadow_resolution'::regclass, true) into viewdef;
  pinned := viewdef like '%pub_region_id%';

  -- limb (a): behavioural, over the at-risk cohort only
  with dup as (
    select city_norm from loc_catalog_city group by city_norm having count(*) > 1
  ), risk as (
    select mv.source_table, mv.listing_id, mv.city as live_city, mv.region as live_region,
           mv.region_raw, s.city_ar_src,
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
  ), bad as (
    select r.source_table, r.listing_id, r.city_ar_src, r.region_raw, r.pub_region_id,
           (select c.city_id from loc_catalog_city c
              join loc_catalog_region rr on rr.region_id = c.region_id
             where c.city_norm = normalize_ar(r.live_city)
                or c.city_norm = normalize_ar(nullif(btrim(r.city_ar_src), ''))
             order by (case when c.city_norm = normalize_ar(nullif(btrim(r.city_ar_src), '')) then 0 else 1 end),
                      (case when r.pub_region_id is not null and c.region_id = r.pub_region_id then 0 else 1 end),
                      (case when normalize_ar(rr.region_ar) = normalize_ar(r.live_region) then 0 else 1 end),
                      c.city_id
             limit 1) as picked_city_id
    from risk r
    where r.pub_region_id is not null
      and exists (select 1 from loc_catalog_city c
                   where c.region_id = r.pub_region_id and c.city_norm = r.nkey)
  )
  select count(*), coalesce(jsonb_agg(x order by x->>'source_table', (x->>'listing_id')::bigint), '[]'::jsonb)
    into total, sample
  from (
    select jsonb_build_object(
             'source_table', b.source_table, 'listing_id', b.listing_id,
             'city_ar_src', b.city_ar_src, 'published_region', b.region_raw,
             'published_region_id', b.pub_region_id,
             'picked_city_id', b.picked_city_id, 'picked_region_id', c.region_id) as x
    from bad b left join loc_catalog_city c on c.city_id = b.picked_city_id
    where c.region_id is distinct from b.pub_region_id
    limit 25
  ) q;

  if total > 0 or not pinned then
    n := public.mon_raise('P1', 'phasea_offregion_pick', 'all', 'phasea_offregion_pick',
      jsonb_build_object(
        'count', total,
        'ordering_pinned', pinned,
        'sample', sample,
        'why', 'phasea_shadow_resolution picked a city OUTSIDE the region the platform itself '
               'published, while a city of that name exists inside it - or the view no longer '
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
                  'its published region keeps the deterministic city_id tiebreak.'));
  else
    perform public.mon_resolve_key('phasea_offregion_pick', 'phasea_offregion_pick');
  end if;

  return n;
end
$function$;

comment on function public.mon_detect_phasea_offregion_pick() is
'Rule 24a guard at the phasea stage. Measured cost 2026-08-21: 3,963 ms on the at-risk cohort
(1,553 rows / 28 catalog-duplicate city names). Reading the real view instead costs 50,202 ms, which
is why limb (a) replicates the ordering and limb (b) pins the view definition. Read 21-27 s style
figures as normal for the heavy detectors; 60 s+ here is a real regression. A standing 0 is the
healthy reading - after 20260821 the condition is unreachable by construction, so this is a
regression guard on phasea''s ORDER BY, not a live-traffic detector.';

-- Roster registration, in the SAME migration (AGENTS.md: a detector outside mon_run_all_detectors
-- is decoration, and mon_detect_orphaned_detectors fires on anything nothing reaches).
do $roster$
declare
  src text; needle text := '''mon_detect_discarded_location_resolution'',';
  ins text := '''mon_detect_discarded_location_resolution'',
    ''mon_detect_phasea_offregion_pick'',';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found';
  end if;

  if position('mon_detect_phasea_offregion_pick' in src) > 0 then
    raise notice 'already registered; nothing to do';
    return;
  end if;

  if (length(src) - length(replace(src, needle, ''))) / length(needle) <> 1 then
    raise exception 'roster needle not found exactly once - refusing a blind edit';
  end if;

  execute replace(src, needle, ins);
end
$roster$;

-- Reachability check: fail the migration if the roster cannot reach the new detector.
do $check$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_phasea_offregion_pick' in src) = 0 then
    raise exception 'roster registration failed - detector would be decoration';
  end if;
end
$check$;
