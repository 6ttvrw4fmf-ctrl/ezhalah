-- Data Integrity run 2026-08-29.
--
-- PART 1 — two source-proven prices stop being hidden.
--
-- 1143359 (AQM6188874) and 1661535 (AQM6156982) are the two aqarmonthly rows the 2026-08-28 wasalt
-- adjudication left as genuinely UNKNOWN ("price_evidence.reason = adapter_emitted_no_evidence.
-- No archived figure exists to check against"). They are no longer unknown: aqar's OWN GraphQL
-- endpoint — the exact field scrapers/aqarmonthly/run.py reads,
-- DailyRenting.getCalculatedBookingPriceWithDiscount(...).discounted_price — was queried live on
-- 2026-08-29 and answered at the SAME magnitude we store. On 6156982 it answered the stored figure
-- EXACTLY. The unit is SAR, not halalas: the platform's own median stored monthly is 10,866 SAR
-- over 1,739 active rows, so a 33,000,000 SAR/month figure is an outlier aqar publishes, not a
-- scale error we introduced.
--
-- Both rows carry a city AND a region, so they fail the unlocated-search fallback (which requires a
-- NULL location) while enforce_price_size_sanity() had set production_ready=false — i.e. they were
-- unreachable by EVERY Normal Filter combination. The gate is not malfunctioning; it was missing
-- evidence, and registering a proven row is its sanctioned lever (owner rule: a source-published
-- price is stored and searchable at ANY magnitude).
insert into public.ops_price_source_verified (source_table, listing_id, evidence, verified_at)
values
  ('aqarmonthly_residential_listings', 1661535,
   'Live source probe 2026-08-29 (Data Integrity run): sa.aqar.fm/graphql '
   || 'DailyRenting.getCalculatedBookingPriceWithDiscount(listing_id:6156982, +1d..+31d) returned '
   || 'discounted_price = total_price = 32999967. Stored price_annual = 395999604 = 32999967 x 12, '
   || 'the scraper''s documented monthly->annual transform. EXACT match to the source field. '
   || 'Unit is SAR (platform median stored monthly = 10,866 over 1,739 active rows). Source-published.',
   now()),
  ('aqarmonthly_residential_listings', 1143359,
   'Live source probe 2026-08-29 (Data Integrity run): sa.aqar.fm/graphql '
   || 'DailyRenting.getCalculatedBookingPriceWithDiscount(listing_id:6188874, +1d..+31d) returned '
   || 'discounted_price = total_price = 90412109.48 — SAME magnitude (~1e8) as the stored '
   || 'price_annual 1215613527 (= 101301127.25 x 12 captured at an earlier booking window; this '
   || 'vertical prices per 30-day window, so the exact figure is window-dependent BY DESIGN and a '
   || 'window difference is not a discrepancy). aqar''s own pricing engine returns this magnitude '
   || 'for this listing, so the stored value is not an Ezhalah artifact. Source-published magnitude.',
   now())
on conflict do nothing;

-- PART 2 — the barrier for the bug class, because this is the SECOND time in 8 hours.
--
-- Run #68 (2026-08-28 23:01) found 15 located rows unreachable by every Filter combination and
-- registered 13 of them. This run found the remaining 2 by re-deriving the same arithmetic by hand.
-- Nothing in the roster asks the question directly, so nothing would have found them again:
--   * mon_detect_unlocated_search_contract limb (b) checks the OPPOSITE direction (production_ready
--     implies city AND region).
--   * price_gate_withheld (mon_detect_impossible_price_size) counts withheld rows without
--     distinguishing "still reachable through the unlocated fallback" from "reachable by nothing".
--
-- The invariant this pins is structural and platform-independent: the Normal Filter admits a row
-- through exactly two branches — production_ready with a location, or the unlocated fallback, which
-- requires city_id IS NULL. A row with a city_id that is not production_ready satisfies neither, so
-- it is served to nobody regardless of what a count says. A standing 0 is the healthy reading
-- (docs/ops/DATA_INTEGRITY_ENGINEER.md section 24c).
create or replace function public.mon_detect_located_row_unreachable()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  rec record; n int := 0; live_keys text[] := '{}';
begin
  for rec in
    select s.source_table, s.listing_id, s.platform, s.city_ar, s.deal_ar,
           s.price_total, s.price_annual, s.area_m2,
           public.price_size_impossible(s.price_total, s.price_annual, s.area_m2) as trips_price_gate
      from public.search_listings_ar s
     where s.city_id is not null
       and not s.production_ready
     order by s.source_table, s.listing_id
     limit 200
  loop
    live_keys := live_keys || ('located_row_unreachable:' || rec.source_table || ':' || rec.listing_id::text);
    n := n + public.mon_raise('P1', 'located_row_unreachable', rec.platform,
      'located_row_unreachable:' || rec.source_table || ':' || rec.listing_id::text,
      jsonb_build_object(
        'why', 'This row carries a city_id, so it fails the unlocated-search fallback (which '
             || 'requires city_id IS NULL); and it is not production_ready, so it fails the located '
             || 'branch. It is therefore unreachable by EVERY Normal Filter combination while still '
             || 'counting as present in search_listings_ar. Found twice in 8 hours on 2026-08-28/29.',
        'adjudicate', 'Ask WHY production_ready is false. If the price/size gate did it '
             || '(trips_price_gate = true), go to the SOURCE: an extreme value the source itself '
             || 'publishes belongs in ops_price_source_verified with a real evidence string, never '
             || 'repriced and never left hidden. If the source cannot be established, leave it '
             || 'hidden and say so — do NOT widen or bypass the gate, and do NOT register on a hunch.',
        'source_table', rec.source_table, 'listing_id', rec.listing_id,
        'city_ar', rec.city_ar, 'deal_ar', rec.deal_ar,
        'trips_price_gate', rec.trips_price_gate,
        'price_total', rec.price_total, 'price_annual', rec.price_annual, 'area_m2', rec.area_m2));
  end loop;

  -- Evaluated path only (section 23a): the cohort that raises is the same cohort that resolves, so a
  -- cleared row goes GREEN and a genuine re-occurrence can raise again instead of being swallowed by
  -- an already-open dedup key.
  perform public.mon_resolve_stale_keys('located_row_unreachable', live_keys);
  return n;
end $$;

comment on function public.mon_detect_located_row_unreachable() is
  'Data Integrity 2026-08-29: a search_listings_ar row with a city_id that is not production_ready '
  'is admitted by neither RPC branch — served to nobody while counted as present. Raises P1 per '
  'row, resolves on the evaluated path. Measured cost: <100 ms. A standing 0 is healthy.';

-- Roster registration in the SAME migration (section 11a) — splice ONE element into the LIVE roster
-- rather than re-emitting a snapshot, because concurrent sessions edit this function.
do $roster$
declare
  src    text;
  anchor text := '''mon_detect_cron_ordering_contract''';
  needle text := ', ''mon_detect_located_row_unreachable''';
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors not found - refusing to wire blindly';
  end if;

  if position('mon_detect_located_row_unreachable' in src) > 0 then
    raise notice 'already registered; nothing to do';
    return;
  end if;

  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor appears % times, expected exactly 1 - refusing to splice',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;

  execute replace(src, anchor, anchor || needle);
end
$roster$;

do $check$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('mon_detect_located_row_unreachable' in src) = 0 then
    raise exception 'roster registration failed - the detector would be decoration';
  end if;
end
$check$;
