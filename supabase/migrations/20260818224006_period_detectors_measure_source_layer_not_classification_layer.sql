-- Data Integrity run #29, owner product decision 2026-08-18. Two existing P1 detectors went red at
-- 22:29 - within ten minutes of the period fallback landing - and both were right to notice a change
-- and wrong about what it meant. Their oracles conflated two different layers:
--
--   the SOURCE layer   - what the platform actually published (scraper tables -> active_listing_ids_v2
--                        -> listing_native_location_v2.rent_period). Still an honest NULL when the
--                        source says nothing. The probes prove this and it must never be written to.
--   the CLASSIFICATION layer - search_listings_ar.rent_period_ar, what Ezhalah SHOWS. This is where
--                        the owner's fallback lives (in sync_search_listings_ar, the only writer).
--
-- The owner's decision deliberately makes these two disagree: source NULL, classification سنوي. That
-- is the product rule, not a defect. Both detectors asserted a source-truth fact while reading the
-- classification layer, so both would have stayed permanently red - and a permanently-red detector is
-- indistinguishable from a dark one (the 2026-08-10 incident: nine dark detectors read as a clean
-- bill of health).
--
-- NEITHER detector is weakened. Each is re-pointed at the layer its own stated purpose is about, and
-- each is mutation-proven to still catch the exact defect it was built for.
--
-- 1. mon_rent_period_contradicts_probe - purpose, in its own words: catch "importing a platform
--    DEFAULT field as if it were source truth - e.g. aqar's rent_period_text, which reads «سنوي» even
--    on genuinely MONTHLY ads". That defect is an import into the SOURCE layer. Measured now:
--      old oracle (index layer): 60 rows - every one the sanctioned fallback
--      new oracle (source layer): 0 rows - no raw period contradicts any probe
--    The honest NULLs the run #22/#29 live probes established are fully intact, which the new oracle
--    now states positively instead of the old one mistaking the fallback for the aqar defect.
--
-- 2. mon_detect_search_index_diverges_from_sync_source - purpose: catch an index value the next sync
--    will silently overwrite (a repair that reverts within the hour). Its oracle hardcoded the sync's
--    OLD mapping (... else null), so once the sync gained the fallback the oracle no longer predicted
--    what the sync writes. Corrected to mirror the sync's ACTUAL expression, fallback included:
--    0 divergent rows. The detector is still exactly "does the index differ from what the next sync
--    would write" - it just knows what the sync writes now.
--
-- COUPLING NOTE: oracle 2 duplicates the sync's period expression, so it must be updated whenever
-- that expression changes. It is not left unguarded: mon_detect_rent_period_contract() limb 7 asserts
-- structurally that the fallback and its rent-only guard are still present in sync_search_listings_ar,
-- so the expression cannot change silently underneath this oracle.

create or replace function public.mon_rent_period_contradicts_probe()
 returns table(source_table text, listing_id bigint, stored_period text, probed_at timestamp with time zone, observed_subtype text)
 language sql
 stable
as $function$
  with newest as (
    select distinct on (p.source_table, p.listing_id)
           p.source_table, p.listing_id, p.probed_at, p.observed_subtype
      from public.ops_rent_period_source_probe p
     where p.http_status = 200            -- a failed fetch is not evidence of anything (rule #2)
     order by p.source_table, p.listing_id, p.probed_at desc
  )
  -- Compare the SOURCE layer, not the served classification. A probe of 'none' plus «سنوي» in
  -- search_listings_ar is the owner's 2026-08-18 fallback working as designed; a probe of 'none'
  -- plus a non-null period in the SOURCE is the platform-default import this exists to catch.
  select n.source_table, n.listing_id, lv.rent_period, n.probed_at, n.observed_subtype
    from newest n
    join public.listing_native_location_v2 lv
      on lv.source_table = n.source_table and lv.listing_id = n.listing_id
   where n.observed_subtype = 'none'
     and lv.rent_period in ('annual','monthly');
$function$;

comment on function public.mon_rent_period_contradicts_probe() is
  'Rows whose SOURCE-layer rent period contradicts their own live HTTP-200 probe. Reads '
  'listing_native_location_v2.rent_period (what the platform published), NOT '
  'search_listings_ar.rent_period_ar (what Ezhalah shows) - since the owner product decision of '
  '2026-08-18 those legitimately differ, source NULL vs classification سنوي, for 605 rows.';

create or replace function public.mon_detect_search_index_diverges_from_sync_source()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_rows jsonb; total int := 0; n int := 0;
begin
  -- search_listings_ar.rent_period_ar must equal what the next sync would write, because that is
  -- precisely what the next sync WILL write. Any disagreement means one of: a hand-edited index row
  -- the sync is about to clobber (a repair that will revert), a stale matview, or a sync that failed
  -- partway. The expression below MIRRORS sync_search_listings_ar, including the owner's 2026-08-18
  -- annual fallback and its monthly-only-platform exception - an oracle that predicts the old
  -- behaviour flags the whole fallback cohort forever instead of catching real divergence.
  select coalesce(jsonb_agg(x), '[]'::jsonb), count(*) into v_rows, total from (
    select jsonb_build_object(
             'platform', s.platform, 'source_table', s.source_table, 'listing_id', s.listing_id,
             'index_period', s.rent_period_ar, 'sync_source_period', a.rent_period,
             'sync_would_write',
               (case a.rent_period when 'annual' then 'سنوي' when 'monthly' then 'شهري'
                else case when s.platform in ('gathern','aqarmonthly') then 'شهري' else 'سنوي' end end)) as x
      from public.search_listings_ar s
      join public.active_listing_ids_v2 a
        on a.source_table = s.source_table and a.listing_id = s.listing_id
     where s.deal_ar = 'إيجار'
       and s.rent_period_ar is distinct from
           (case a.rent_period when 'annual' then 'سنوي' when 'monthly' then 'شهري'
            else case when s.platform in ('gathern','aqarmonthly') then 'شهري' else 'سنوي' end end)
     limit 200
  ) t;

  if total > 0 then
    n := public.mon_raise('P1', 'search_index_diverges_from_sync_source', 'search_index',
      'search_index_diverges_from_sync_source',
      jsonb_build_object(
        'divergent_rows', total,
        'sample', (select jsonb_agg(e) from (select e from jsonb_array_elements(v_rows) e limit 10) s),
        'why', 'The served search index disagrees on rent period with what sync_search_listings_ar() '
               'would write from active_listing_ids_v2. The index value is therefore NOT durable: '
               'the next sync (cron jobid 28, minute 14) will overwrite it. Most often this is a '
               'raw-layer data repair whose index leg was written directly without refreshing '
               'active_listing_ids_v2 first (matview refresh is jobid 17, minute 0) - the repair '
               'looks verified and silently reverts within the hour. FIX: correct the RAW row, then '
               'REFRESH MATERIALIZED VIEW CONCURRENTLY active_listing_ids_v2, then run '
               'sync_search_listings_ar(), then re-verify. Do not "fix" this by editing '
               'search_listings_ar again; that reproduces the same revert. NOTE: a NULL source period '
               'mapping to «سنوي» is NOT divergence - it is the owner fallback of 2026-08-18, which '
               'this oracle mirrors.'));
  else
    perform public.mon_resolve_key('search_index_diverges_from_sync_source',
                                   'search_index_diverges_from_sync_source');
  end if;
  return n;
end $function$;;
