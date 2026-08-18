-- Data Integrity run #29 follow-up, same session: the two-limb detector was CORRECT and too
-- expensive — 3,614 ms per sweep, because the cohort predicate (two correlated count(distinct)
-- subqueries over 240,774 listings_arabic_locations rows) was re-evaluated four times per run
-- (ledger delete, ledger insert, limb A count, limb B count) and each evaluation dragged the
-- listing_native_location_v2 join with it. §23: a correctness fix is not finished until its COST
-- has been measured — a detector that eats a 60 s roster budget raises detector_crash and stops
-- protecting its own class, which is worse than the bug it fixes.
--
-- Fix: the view is the cohort ONLY (exactly the predicate the detector has always used, no v2).
-- The detector evaluates it ONCE into a temp table, then joins listing_native_location_v2 to that
-- handful of keys to decide the limb. Semantics are unchanged in every direction; only the number
-- of evaluations changes.

create or replace view public.mon_discarded_location_candidates as
select s.source_table,
       s.listing_id,
       s.platform,
       s.city_ar   as search_city_ar,
       l.city_ar   as resolved_city_ar,
       l.region_ar as resolved_region_ar
  from public.search_listings_ar s
  join public.listings_arabic_locations l
    on l.source_table = s.source_table and l.listing_id = s.listing_id
 where s.city_id is null
   and l.matched
   and l.city_ar is not null
   and (
     (select count(distinct cc.city_id) from public.loc_catalog_city cc
       where cc.city_norm = public.normalize_ar(l.city_ar)) = 1
     or
     (l.region_ar is not null
      and (select count(distinct cc.city_id)
             from public.loc_catalog_city cc
             join public.loc_catalog_region cr on cr.region_id = cc.region_id
            where cc.city_norm = public.normalize_ar(l.city_ar)
              and cr.region_ar = l.region_ar) = 1)
   );

comment on view public.mon_discarded_location_candidates is
  'THE single definition of the discarded-location cohort (the detector used to carry two copies of '
  'this predicate, one for the count and one for the sample). A row here has an unambiguous '
  'canonical city in listings_arabic_locations and no city_id in search_listings_ar. Deliberately '
  'does NOT join listing_native_location_v2: the detector classifies the limb by joining v2 to this '
  'handful of keys once, instead of paying for v2 on every evaluation.';

create or replace function public.mon_detect_discarded_location_resolution()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n int := 0;
  grace constant interval := interval '75 minutes';   -- sync-search-listings-ar is hourly (jobid 28, :14)
  a_cnt int; b_cnt int; a_sample jsonb; b_sample jsonb;
begin
  drop table if exists pg_temp._dlr_cohort;
  create temp table _dlr_cohort on commit drop as
  select c.*,
         case
           when v.source_table is null then 'not_in_v2'
           when v.city_id is null      then 'pipeline_discard'
           else                             'sync_not_propagated'
         end as limb,
         v.city_id as v2_city_id
    from public.mon_discarded_location_candidates c
    left join public.listing_native_location_v2 v
      on v.source_table = c.source_table and v.listing_id = c.listing_id;

  -- Ledger: drop anything that left the cohort, remember when each current member arrived.
  delete from public.ops_discarded_location_seen d
   where not exists (select 1 from pg_temp._dlr_cohort c
                      where c.source_table = d.source_table and c.listing_id = d.listing_id);

  insert into public.ops_discarded_location_seen (source_table, listing_id)
  select distinct c.source_table, c.listing_id from pg_temp._dlr_cohort c
      on conflict (source_table, listing_id) do nothing;

  -- ---- limb A: the pipeline discarded its own answer. No grace. -------------------------------
  select count(*) into a_cnt from pg_temp._dlr_cohort where limb = 'pipeline_discard';

  if coalesce(a_cnt, 0) > 0 then
    select jsonb_agg(x) into a_sample from (
      select source_table, listing_id, platform, search_city_ar, resolved_city_ar, resolved_region_ar
        from pg_temp._dlr_cohort where limb = 'pipeline_discard'
       order by source_table, listing_id limit 20) x;

    n := n + public.mon_raise('P1', 'discarded_location_resolution', 'all', 'discarded_location_resolution',
      jsonb_build_object(
        'count', a_cnt,
        'limb', 'pipeline_discard',
        'sample', a_sample,
        'why', 'These listings have a matched=true resolution in listings_arabic_locations that identifies EXACTLY ONE canonical catalog city - either unambiguously by name, or unambiguously within the region recorded on the same resolution row - and listing_native_location_v2 STILL yields no city_id. Ezhalah computed the answer and discarded it: this is not sync lag (limb B covers that) and not a source limitation (the resolution is already in our own tables). They are production_ready=false and NO Filter combination can return them. Check the fallback chain in listing_native_location_v2 (COALESCE v1.city_id -> uali -> ulg -> ulg2 -> uc) and the precedence in listing_native_location_v1.best, which must never let a native row that resolves to NULL outrank a legacy row that resolves to a city.',
        'do_not', 'Do NOT fix this by writing a city onto the listing table, and do NOT relax either unambiguity gate. A name that is ambiguous even inside its own recorded region is excluded here on purpose and must stay NULL.'));
  else
    perform public.mon_resolve_key('discarded_location_resolution', 'discarded_location_resolution');
  end if;

  -- ---- limb B: v2 has the city, search does not, and a sync cycle has already passed ----------
  select count(*) into b_cnt
    from pg_temp._dlr_cohort c
    join public.ops_discarded_location_seen d
      on d.source_table = c.source_table and d.listing_id = c.listing_id
   where c.limb = 'sync_not_propagated'
     and d.first_seen_at < now() - grace;

  if coalesce(b_cnt, 0) > 0 then
    select jsonb_agg(x) into b_sample from (
      select c.source_table, c.listing_id, c.platform, c.resolved_city_ar, c.v2_city_id, d.first_seen_at
        from pg_temp._dlr_cohort c
        join public.ops_discarded_location_seen d
          on d.source_table = c.source_table and d.listing_id = c.listing_id
       where c.limb = 'sync_not_propagated' and d.first_seen_at < now() - grace
       order by d.first_seen_at limit 20) x;

    n := n + public.mon_raise('P1', 'discarded_location_resolution', 'all', 'discarded_location_resolution:sync_not_propagated',
      jsonb_build_object(
        'count', b_cnt,
        'limb', 'sync_not_propagated',
        'sample', b_sample,
        'grace_minutes', 75,
        'why', 'listing_native_location_v2 HAS a city_id for these rows and search_listings_ar still does not, and that has now outlived a full sync cycle. Ordinary <=1h lag is excluded by the grace window, so this is sync_search_listings_ar() failing to carry a resolution through: check jobid 28 (sync-search-listings-ar, hourly at :14) actually ran, and that its city_id/region_id change-detection arm still re-upserts a row whose location changed while nothing else did.',
        'do_not', 'Do NOT write a city onto search_listings_ar by hand. The sync is the only writer of that column; repairing its output leaves the broken writer in place and the next sweep undoes you.'));
  else
    perform public.mon_resolve_key('discarded_location_resolution', 'discarded_location_resolution:sync_not_propagated');
  end if;

  drop table if exists pg_temp._dlr_cohort;
  return n;
end
$function$;

comment on function public.mon_detect_discarded_location_resolution() is
  'P1. Two limbs, settled by Data Integrity run #29 (2026-08-18). limb A pipeline_discard = the '
  'run #26 defect (listing_native_location_v2 itself resolves to nothing while '
  'listings_arabic_locations resolves a city) - raised immediately. limb B sync_not_propagated = v2 '
  'has the city, search_listings_ar does not - raised only after 75 min, because '
  'sync-search-listings-ar is hourly (jobid 28, :14) and the single-limb detector spent five windows '
  'of 2026-08-18 red on rows that were merely in flight (8, 53, 32, 6, 19 rows; every one cleared by '
  'the next sync). An always-red detector cannot raise the real thing: mon_raise() returns 0 on an '
  'open dedup key. Rows absent from v2 belong to mon_detect_orphaned_search_row and are excluded '
  'from both limbs. The cohort is evaluated ONCE per sweep into pg_temp._dlr_cohort: evaluating it '
  'per-limb cost 3,614 ms, and a detector that eats the roster budget protects nothing.';
