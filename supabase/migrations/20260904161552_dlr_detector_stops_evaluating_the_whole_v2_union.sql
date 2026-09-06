-- mon_detect_discarded_location_resolution was the most expensive detector in the sweep:
-- p90 87.9s, MAX 690.9s over 7 days -- 77% of the whole 900s budget in ONE detector, and the
-- detector both 2026-09-04 sweep aborts (06:29Z, 06:59Z) died inside.
--
-- MEASURED ROOT CAUSE (EXPLAIN of the exact cohort query):
--   Nested Loop Left Join            cost 67862.88 .. 6151880.85   rows=1
--     Join Filter: (v.source_table = c.source_table AND v.listing_id = c.listing_id)
--     ->  candidates (left side)     cost     0.84 ..    7599.14   rows=1
--     ->  Append  (v2 UNION)         cost 67862.04 .. 6143434.42   rows=56486
-- The candidate side is CHEAP -- mon_discarded_location_candidates returns 0 rows in 37 ms today
-- (only 464 of 197,559 search rows have city_id IS NULL at all). The entire cost is the right
-- side: because the keys arrive through a Join Filter rather than as constants, nothing can be
-- pushed into listing_native_location_v2, so the whole ~60-branch UNION is evaluated to look up
-- at most a few hundred listings -- and it is evaluated even when there are ZERO candidates,
-- which is the normal state. The detector was paying 6.1M cost to answer a question about
-- nothing.
--
-- MEASURED FIX. Pushdown works, but ONLY for a scalar source_table constant, which prunes the
-- UNION to a single branch. Timings taken on production:
--   whole-view join (status quo)                                p90 87.9s / max 690.9s
--   source_table = <const> AND listing_id = <const>                          245 ms
--   source_table = <const>  (whole branch, 50,272 rows)                    2,058 ms
--   source_table = <const> AND listing_id = any(array[...])                2,501 ms
--   (source_table, listing_id) IN ((...),(...))  -- multi-pair             5,768 ms
--   OR-chain of literal pairs                                             5,688 ms
--   LATERAL / VALUES-CTE correlated join  (no parameterised path)         10,829 ms
--   source_table = any(array[...])  -- 2 tables                           10,911 ms
-- So the cohort is now built by looking up ONLY the candidate keys, one PRUNED query per distinct
-- candidate source_table, with the table name inlined as a literal via format(%L) so the planner
-- provably sees a constant (a PL/pgSQL variable would risk a generic plan and lose the pruning).
--
-- WHY THIS IS SAFE, PROVEN ON PRODUCTION DATA, NOT ASSUMED. Filtering the view early is only
-- equivalent if no v2 branch aggregates ACROSS source_tables. Verified by materialising both
-- sides -- the pruned query, and the full view forced to evaluate completely behind an `OFFSET 0`
-- optimisation fence and filtered afterwards -- then comparing with EXCEPT ALL in both directions
-- (EXCEPT ALL, so row multiplicity is compared too, not just set membership):
--   souq24_residential_listings    pruned 42     full 42     diff 0 / 0
--   wasalt_residential_listings    pruned 50,272 full 50,272 diff 0 / 0
-- and (source_table, listing_id) carries no duplicates, so the LEFT JOIN's multiplicity is
-- unchanged. The staged rows are NOT de-duplicated here, so even a future duplicate would join
-- exactly as it does today.
--
-- NOTHING ELSE CHANGES. Same candidate view and predicate, same three limb rules, same 75-minute
-- grace, same ledger maintenance, same severities, dedup keys, sample shape and message text,
-- same every-sweep cadence. This detector is deliberately NOT gated behind mon_claim_daily_slot:
-- limb B's grace is tied to the hourly sync job (jobid 28), so a 20h gate would turn a ~75-minute
-- detection latency into a 20-hour one for a P1 search-reachability condition. It is now cheap
-- enough that it does not need one.
--
-- The empty case needs no special-casing and gets none: with no candidates the FOR loop runs zero
-- times, so NO v2 query is issued at all, the cohort is empty, the ledger DELETE correctly clears
-- every stale row exactly as an empty cohort always made it do, both limbs count 0 and both keys
-- resolve. Identical behaviour, ~40 ms instead of ~88 s.

CREATE OR REPLACE FUNCTION public.mon_detect_discarded_location_resolution()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  n int := 0;
  grace constant interval := interval '75 minutes';   -- sync-search-listings-ar is hourly (jobid 28, :14)
  a_cnt int; b_cnt int; a_sample jsonb; b_sample jsonb;
  r record;
begin
  -- The candidate set is the cheap side and it decides everything below.
  drop table if exists pg_temp._dlr_cand;
  create temp table _dlr_cand on commit drop as
    select * from public.mon_discarded_location_candidates;

  -- Only the v2 rows belonging to those candidates. One query per distinct source_table, with the
  -- name inlined as a LITERAL so the planner prunes the UNION to that single branch.
  drop table if exists pg_temp._dlr_v2;
  create temp table _dlr_v2 (source_table text, listing_id bigint, city_id integer) on commit drop;

  for r in select distinct c.source_table from pg_temp._dlr_cand c loop
    execute format(
      'insert into pg_temp._dlr_v2 (source_table, listing_id, city_id)
         select v.source_table, v.listing_id, v.city_id
           from public.listing_native_location_v2 v
          where v.source_table = %L
            and v.listing_id in (select c.listing_id
                                   from pg_temp._dlr_cand c
                                  where c.source_table = %L)',
      r.source_table, r.source_table);
  end loop;

  drop table if exists pg_temp._dlr_cohort;
  create temp table _dlr_cohort on commit drop as
  select c.*,
         case
           when v.source_table is null then 'not_in_v2'
           when v.city_id is null      then 'pipeline_discard'
           else                             'sync_not_propagated'
         end as limb,
         v.city_id as v2_city_id
    from pg_temp._dlr_cand c
    left join pg_temp._dlr_v2 v
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
  drop table if exists pg_temp._dlr_v2;
  drop table if exists pg_temp._dlr_cand;
  return n;
end
$function$;
