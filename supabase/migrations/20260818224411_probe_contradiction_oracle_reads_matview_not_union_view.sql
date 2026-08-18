-- Data Integrity run #29 - cost correction to the fix applied minutes earlier in this session.
--
-- Re-pointing mon_rent_period_contradicts_probe() at the SOURCE layer was correct. Reading that
-- layer through listing_native_location_v2 was not: that view is three UNION branches over a matview
-- and cannot use an index for this join, so the detector went from milliseconds to over 60 seconds
-- (it timed out twice while being verified). That is the exact defect this run already fixed once
-- today - a detector that eats the roster budget protects nothing (docs/ops/
-- DATA_INTEGRITY_ENGINEER.md §24b; the discarded-location detector, 3,614ms -> 988ms).
--
-- active_listing_ids_v2 carries the same source-layer rent_period - it IS the relation
-- sync_search_listings_ar() reads, and the relation listing_native_location_v2 branches over - and
-- it joins on (source_table, listing_id) cheaply. Same question, same answer (0 contradicting rows),
-- back to a cost the twice-hourly roster can afford.

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
  select n.source_table, n.listing_id, a.rent_period, n.probed_at, n.observed_subtype
    from newest n
    join public.active_listing_ids_v2 a
      on a.source_table = n.source_table and a.listing_id = n.listing_id
   where n.observed_subtype = 'none'
     and a.rent_period in ('annual','monthly');
$function$;

comment on function public.mon_rent_period_contradicts_probe() is
  'Rows whose SOURCE-layer rent period contradicts their own live HTTP-200 probe. Reads '
  'active_listing_ids_v2.rent_period (what the platform published, via the relation the sync itself '
  'reads), NOT search_listings_ar.rent_period_ar (what Ezhalah shows) - since the owner product '
  'decision of 2026-08-18 those legitimately differ, source NULL vs classification سنوي, for 605 '
  'rows. Deliberately not read through listing_native_location_v2: that view is three UNION branches '
  'and made this detector time out.';
