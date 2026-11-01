-- The repair reached the platform table and stopped there: a street was still SERVED.
--
-- After repair 20260927205755, 33 of the 34 rows showed the right district in search_listings_ar —
-- and AQM5728162 still read «حي شارع ابي الفتوح». Not staleness. `listing_native_location_v1` ends
--     COALESCE(<native district_ar>, <lal.district_ar>)   -- lal = listings_arabic_locations
-- so the honest NULL the parser now produces UNCOVERS a legacy value in that bridge table, and
-- `sync_search_listings_ar()` then runs it through `loc_display_district_ar(city_id, district_ar)`,
-- which re-adds the «حي » prefix — «شارع ابي الفتوح» → «حي شارع ابي الفتوح». The bridge holds the
-- pre-PR-#4995 naive slug parse (`re.search(r"حي\s+(\S+(?:\s+\S+){0,2})")`, no «حي » prefix), frozen:
-- nothing writes aqarmonthly rows there any more (of the seven functions that write the table —
-- resolve_aqar_locations, resolve_dealapp_districts, resolve_raghdan_city, … — none mentions
-- aqarmonthly), so these values are a one-time legacy deposit that only a clear can remove.
--
-- 13 aqarmonthly bridge rows hold a street. ONE of them leaks today (its native district is NULL);
-- the other 12 are masked only because their native district is currently non-NULL — the moment any
-- of those listings loses its district, a street resurfaces in the served index. All 13 belong to the
-- same 36 rows repair 20260927205755 just fixed, and every value is that row's own street. Clearing
-- them disarms the resurrection path for the whole cohort, not just the one instance.
--
-- `raw_district` is deliberately left alone: it is the audit record of what the old parse captured.
-- Only `district_ar` — the column v1 actually COALESCEs — is cleared. City and region are untouched.
--
-- The index row is then re-derived with the sync's OWN expression, read from the platform table
-- rather than from v1: v1 is a matview last refreshed at 21:20 UTC, before this clear, so reading it
-- here would copy the value being removed. The hourly chain (job 17 at :20 → job 28 at :22) recomputes
-- the same answer afterwards, so this is idempotent, not a divergence.
do $mig$
declare n_bridge int; n_index int; n_raw int; n_left_bridge int; n_left_index int;
begin
  update public.listings_arabic_locations
     set district_ar = null
   where platform = 'aqarmonthly'
     and district_ar ~ '^(حي )?(شارع|طريق|ممر)';
  get diagnostics n_bridge = row_count;

  -- Exactly what sync_search_listings_ar() computes for this column, sourced from the platform table.
  update public.search_listings_ar s
     set district_ar = public.loc_display_district_ar(l.city_id, l.district_ar)
    from public.aqarmonthly_residential_listings l
   where s.source_table = 'aqarmonthly_residential_listings'
     and s.listing_id = l.id
     and s.district_ar ~ '^(حي )?(شارع|طريق|ممر)';
  get diagnostics n_index = row_count;

  raise notice 'street-as-district: % bridge row(s) cleared, % served row(s) re-derived',
    n_bridge, n_index;

  select count(*) into n_raw from public.aqarmonthly_residential_listings
   where district_ar ~ '^(حي )?(شارع|طريق|ممر)' or neighborhood ~ '^(حي )?(شارع|طريق|ممر)';
  select count(*) into n_left_bridge from public.listings_arabic_locations
   where platform = 'aqarmonthly' and district_ar ~ '^(حي )?(شارع|طريق|ممر)';
  select count(*) into n_left_index from public.search_listings_ar
   where source_table = 'aqarmonthly_residential_listings'
     and district_ar ~ '^(حي )?(شارع|طريق|ممر)';

  if n_raw + n_left_bridge + n_left_index > 0 then
    raise exception 'a street is still a district on aqarmonthly: % raw, % bridge, % served',
      n_raw, n_left_bridge, n_left_index;
  end if;
end $mig$;

-- The detector could not have caught either surface. Its regexes required the «حي » prefix, and the
-- bridge is exactly where the BARE form lives; and it never looked at the bridge at all, which is the
-- only surface that can resurrect this defect without a scrape. Both fixed, with a third limb.
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
  -- does, and loc_display_district_ar() adds it on the way into the index. One pattern, all three.
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

  -- LIMB 3 — the BRIDGE. listing_native_location_v1 COALESCEs to listings_arabic_locations when the
  -- native district is NULL, so a street sitting here is a landmine: it is invisible while the
  -- listing has a district and resurfaces the moment it loses one. Repair 20260927205755 looked clean
  -- on the platform table while this table still served «حي شارع ابي الفتوح» to users.
  select count(*) into v_bridge
    from public.listings_arabic_locations
   where platform = 'aqarmonthly' and district_ar ~ pat;

  if v_bridge > 0 then
    live := live || (k || ':bridge');
    n := n + public.mon_raise('P2', k, 'aqarmonthly', k || ':bridge',
      jsonb_build_object(
        'rows', v_bridge,
        'why', 'listings_arabic_locations holds a street as the district for these listings. v1 '
            || 'COALESCEs to it whenever the platform table''s district is NULL, so this outranks an '
            || 'honest NULL and puts a street back in front of users — exactly what happened to '
            || 'AQM5728162 after the platform table was repaired.',
        'action', 'Nothing writes aqarmonthly rows in that table any more (it is a legacy deposit of '
            || 'the pre-#4995 slug parse), so clear district_ar for the offending rows and leave '
            || 'raw_district as the audit record. If something HAS started writing them, fix that '
            || 'writer first — a cleared row it rewrites is a repair that will be retracted.'));
  end if;

  perform public.mon_resolve_stale_keys(k, live);
  return n;
end
$function$;

comment on function public.mon_detect_aqarmonthly_street_as_district() is
  'P2 when an aqarmonthly listing has a street where its district belongs («حي شارع …» or the bare '
  '«شارع …»), on ANY of the three surfaces that can serve one: the raw table (district_ar and the '
  'card''s neighborhood), the served index, and the listings_arabic_locations fallback v1 COALESCEs '
  'to. The standing half of repairs 20260927205755 and this one. BLIND-guarded on aqarmonthly runs.';
