-- The aqarmonthly rows in listings_arabic_locations stop claiming a district at all.
--
-- WHAT THIS FINISHES. 20260927213758 cleared 13 bridge rows whose district was a STREET, because
-- `listing_native_location_v1` ends COALESCE(<native district_ar>, <lal.district_ar>) and an honest
-- NULL in the platform table UNCOVERS whatever the bridge holds. That fixed the shape that was
-- leaking. It left the rest of the same cohort: districts with the CITY glued on — «الامير نايف
-- المجمعة», «الروضة جدة جدة», «الرمال الرياض الرياض» — the pre-#4995 naive slug parse, frozen.
-- 342 of 788 aqarmonthly bridge rows carried one.
--
-- WHY CLEARED AND NOT STRIPPED. The repo's canonical strip
-- `strip_district_city_suffix(d, district_trailing_catalog_city_norm(d))` HALF-STRIPS this cohort.
-- Its two-token floor exists to protect «حي أحد» in «احد رفيده», and it assumes the value begins with
-- «حي ». These bridge values do NOT carry that prefix, so the floor bites one token early and the
-- DOUBLED city shape survives it: «الروضة جدة جدة» → «الروضة جدة», «الرمال الرياض الرياض» →
-- «الرمال الرياض». Measured on all 168 rows the function would touch. A value that still carries a
-- city but now looks clean is worse than the one it replaced — that is the half-strip
-- scripts/verify-aqarmonthly-district-suffix-guard.ts's longest-window rule exists to prevent.
--
-- WHY CLEARING LOSES NOTHING — measured, not assumed, over all 788 aqarmonthly bridge rows:
--   * rows where the bridge has a district and the platform table does NOT ................  0
--     so no listing depends on the bridge for its district.
--   * rows where both have one, and they name a DIFFERENT place (norm_district_tok) .......  0
--     of 561 pairs: 12 identical keys, 549 exactly "the platform's district + glued city tokens".
--   The bridge never knows something the platform table does not. It only knows it worse.
--
-- WHY NOT COPY THE PLATFORM VALUE INTO IT. A copy is a fresh landmine. This table is frozen for
-- aqarmonthly — of the seven functions that write it (resolve_aqar_locations,
-- resolve_dealapp_districts, resolve_raghdan_city, resolve_amlakalahsa_locations,
-- resolve_english_city_overlay, resolve_dealapp_city, resolve_small_platform_cities) not one
-- mentions aqarmonthly — so any value left here can only go stale, and it OUTRANKS an honest NULL
-- the moment a listing loses its district. That is precisely how AQM5728162 kept serving
-- «حي شارع ابي الفتوح» after the platform table was already clean, and how AQM6095977 kept serving
-- «الشرق الرياض» after 20260927201934 had cleared it. The district is authoritative in ONE place.
--
-- WHAT IS DELIBERATELY NOT TOUCHED. `raw_district` (575 rows) stays as the audit record of what the
-- old parse captured. `city_ar` (754), `region_ar` and `matched` (754) stay: four detectors read
-- this table for CITY resolution and none reads its district —
-- mon_detect_aqarmonthly_district_suffix_repair_regressed (strips a suffix using l.city_ar for
-- listings 762041/762272/1097370), mon_detect_district_only_city_inference,
-- mon_detect_city_resolution_ignores_region and mon_detect_discarded_location_resolution all key on
-- `l.matched and l.city_ar is not null`. Clearing the district leaves every one of them unchanged.
do $mig$
declare n_cleared int; n_left int; n_orphaned int;
begin
  -- Fail closed if the no-loss invariant this repair rests on is not actually true right now.
  select count(*) into n_orphaned
    from public.listings_arabic_locations b
    left join public.aqarmonthly_residential_listings l on l.id = b.listing_id
   where b.platform = 'aqarmonthly'
     and b.district_ar is not null
     and (l.id is null or l.district_ar is null);
  if n_orphaned > 0 then
    raise exception 'refusing: % aqarmonthly bridge row(s) are the ONLY source of a district — '
                    'clearing them would lose information', n_orphaned;
  end if;

  update public.listings_arabic_locations
     set district_ar = null
   where platform = 'aqarmonthly'
     and district_ar is not null;
  get diagnostics n_cleared = row_count;

  raise notice 'aqarmonthly location bridge: % district claim(s) cleared', n_cleared;

  select count(*) into n_left
    from public.listings_arabic_locations
   where platform = 'aqarmonthly' and district_ar is not null;
  if n_left > 0 then
    raise exception 'aqarmonthly bridge still claims % district(s)', n_left;
  end if;

  -- The columns other detectors depend on must survive untouched.
  if (select count(*) from public.listings_arabic_locations
       where platform = 'aqarmonthly' and city_ar is not null) <> 754
     or (select count(*) from public.listings_arabic_locations
          where platform = 'aqarmonthly' and raw_district is not null) <> 575 then
    raise exception 'collateral damage: city_ar or raw_district changed on the aqarmonthly bridge';
  end if;
end $mig$;

-- The standing half. Limb 3 of this detector watched the bridge for a STREET; the invariant is now
-- stronger and simpler — the aqarmonthly bridge claims no district at all — so the limb asserts that
-- instead. A value appearing here later does not mean a street came back, it means something started
-- writing a table that has been frozen for this platform, which is the thing worth being told.
create or replace function public.mon_detect_aqarmonthly_street_as_district()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n        int := 0;
  live     text[] := '{}';
  k        text := 'aqarmonthly_street_as_district';   -- a VARIABLE, not a bare literal (20260927211052)
  -- «حي » is OPTIONAL: the platform table always carries the prefix, listings_arabic_locations never
  -- does, and loc_display_district_ar() adds it on the way into the index. One pattern, all surfaces.
  -- «مخطط» stays OUT on evidence: «حي مخطط المحمدية» is a district Aqar publishes in its own district
  -- URL segment, on 313 aqar_* rows (2026-09-27). Extend the parser and this list TOGETHER, never one.
  pat      text := '^(حي )?(شارع|طريق|ممر)';
  v_fresh  timestamptz;
  v_raw    int;
  v_idx    int;
  v_bridge int;
  v_sample jsonb;
begin
  -- BLINDNESS GUARD (AGENTS.md: a monitor that cannot see is not a clean bill of health). This
  -- corruption is re-introduced by a SCRAPE, so "0 street districts" only means something while
  -- aqarmonthly is actually running. If it has stalled, say BLIND rather than return a healthy 0.
  select max(finished_at) into v_fresh
    from public.scrape_runs
   where platform = 'aqarmonthly' and ok;

  if v_fresh is null or v_fresh < now() - interval '7 days' then
    live := live || (k || ':BLIND');
    n := n + public.mon_raise('P2', k, 'aqarmonthly', k || ':BLIND',
      jsonb_build_object(
        'blind', true,
        'last_ok_run', v_fresh,
        'why', 'This detector proves no aqarmonthly listing stores a street as its district. The '
            || 'corruption it watches for is written by a scrape, so with no successful aqarmonthly '
            || 'run in 7 days a 0 here proves nothing.',
        'action', 'Fix the crawl first (.github/workflows/aqarmonthly-sync.yml).'));
    perform public.mon_resolve_stale_keys(k, live);
    return n;
  end if;

  -- LIMB 1 — the raw table: the indexed column AND the one the card renders.
  select count(*) into v_raw
    from public.aqarmonthly_residential_listings
   where district_ar ~ pat or neighborhood ~ pat;

  if v_raw > 0 then
    select jsonb_agg(s) into v_sample
      from (
        select jsonb_build_object('ad_number', ad_number, 'active', active,
                                  'district_ar', district_ar, 'card_shows', neighborhood,
                                  'listing_url', listing_url) as s
          from public.aqarmonthly_residential_listings
         where district_ar ~ pat or neighborhood ~ pat
         order by id
         limit 10
      ) t;

    live := live || k;
    n := n + public.mon_raise('P2', k, 'aqarmonthly', k,
      jsonb_build_object(
        'rows', v_raw,
        'sample', v_sample,
        'why', 'These listings store a STREET where the district belongs — «حي شارع ابن هلال», or '
            || 'even the bare word «حي شارع». Aqar prefixes an EMPTY «حي» label onto the street '
            || 'segment when the ad names no district, and the real district is named later in the '
            || 'same slug. A user searching that district never finds them, and the card lies.',
        'action', 'This is a PARSER regression, not a data problem. resolve_slug() in '
            || 'scrapers/common/arabic_location.py must skip a «حي X» capture whose first token is a '
            || 'street marker and read the next «حي …». Check _STREET_MARKERS and the lookahead '
            || 'capture, and read the rows'' own `address` field before repairing anything: if Aqar '
            || 'has started using a NEW street label, extend the parser AND this detector together.'));
  end if;

  -- LIMB 2 — the SERVED index, what district searches match and what the district list offers.
  select count(*) into v_idx
    from public.search_listings_ar
   where source_table = 'aqarmonthly_residential_listings'
     and district_ar ~ pat;

  if v_idx > 0 then
    live := live || (k || ':index');
    n := n + public.mon_raise('P2', k, 'aqarmonthly', k || ':index',
      jsonb_build_object(
        'rows', v_idx,
        'raw_rows', v_raw,
        'why', 'The SERVED index carries a street as the district for these listings. With '
            || 'raw_rows = 0 the raw table is already clean, so the value is arriving from the '
            || 'listings_arabic_locations fallback in listing_native_location_v1, or the index is '
            || 'stale — sync_search_listings_ar() is INCREMENTAL on last_updated and will not '
            || 'revisit a row whose clock did not move.',
        'action', 'Check limb 3 first. If the bridge is clean too, refresh in ORDER: '
            || 'listing_location_index, listing_location_canonical_mv, listing_native_location_v1, '
            || 'then select * from sync_search_listings_ar() and READ the returned row — no row '
            || 'means the writer lock refused it, not that there was nothing to do.'));
  end if;

  -- LIMB 3 — the BRIDGE, now asserting the stronger invariant that repair
  -- 20260927234500-era left behind: the aqarmonthly rows of listings_arabic_locations claim NO
  -- district. v1 COALESCEs to this table whenever the platform district is NULL, so ANY value here
  -- outranks an honest NULL; and nothing writes aqarmonthly rows here, so any value that appears is
  -- either a resurrected legacy claim or a new writer nobody declared.
  select count(*) into v_bridge
    from public.listings_arabic_locations
   where platform = 'aqarmonthly' and district_ar is not null;

  if v_bridge > 0 then
    select jsonb_agg(s) into v_sample
      from (
        select jsonb_build_object('listing_id', listing_id, 'district_ar', district_ar,
                                  'raw_district', raw_district) as s
          from public.listings_arabic_locations
         where platform = 'aqarmonthly' and district_ar is not null
         order by listing_id
         limit 10
      ) t;

    live := live || (k || ':bridge');
    n := n + public.mon_raise('P2', k, 'aqarmonthly', k || ':bridge',
      jsonb_build_object(
        'rows', v_bridge,
        'sample', v_sample,
        'why', 'listings_arabic_locations claims a district for these aqarmonthly listings. It must '
            || 'not: listing_native_location_v1 COALESCEs to this column whenever the platform '
            || 'table''s district is NULL, so whatever sits here outranks an honest unknown and is '
            || 'served to users. That is how AQM5728162 kept showing «حي شارع ابي الفتوح» and '
            || 'AQM6095977 «الشرق الرياض» after both had been repaired at source.',
            'action', 'Do NOT simply re-clear it. Nothing wrote aqarmonthly rows in this table as of '
            || '2026-09-27, so a value here means a writer appeared: find it first (check the '
            || 'resolve_* functions for a new aqarmonthly arm) and decide whether it should own the '
            || 'district at all. The platform table is the single authority; raw_district is the '
            || 'audit record and is expected to stay populated.'));
  end if;

  perform public.mon_resolve_stale_keys(k, live);
  return n;
end
$function$;

comment on function public.mon_detect_aqarmonthly_street_as_district() is
  'P2 when an aqarmonthly listing has a street where its district belongs («حي شارع …» or the bare '
  '«شارع …») in the raw table (district_ar and the card''s neighborhood) or the served index, OR when '
  'listings_arabic_locations claims any district for an aqarmonthly listing — v1 COALESCEs to that '
  'column over an honest NULL. The standing half of repairs 20260927205755, 20260927213758 and the '
  'bridge clear. BLIND-guarded on aqarmonthly runs.';