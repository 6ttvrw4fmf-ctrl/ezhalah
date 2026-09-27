-- The detector applied minutes earlier (20260927210556) could NOT raise its own alert.
--
-- `live text[] := '{}'` concatenated with a BARE string literal — `live := live || 'some_key'` — does
-- not resolve to anyarray||anyelement in this Postgres: the untyped literal is coerced to text[] and
-- the statement dies with `22P02 malformed array literal: "some_key"`. Every limb of the new detector
-- reached that line only when it had something to report, so the detector returned a healthy 0 while
-- being structurally incapable of raising a P2 — the "green barrier that cannot fire" class AGENTS.md
-- calls this repo's most expensive lesson. Caught by executing the detector, not by reading it.
--
-- The fix is the shape the detectors that DO fire already use: a declared text variable, or a
-- parenthesised text expression. Both were proven in a standalone DO block before this landed:
--     live := live || k;                 -- declared text variable   (mon_detect_cleanup_run_unrecorded)
--     live := live || (k || ':index');   -- text expression          (mon_detect_rows_collapse, …)
-- Nothing else about the detector changes: same limbs, same thresholds, same blindness guard.
--
-- NOT fixed here, deliberately: five sibling detectors carry the same dead literal and cannot raise
-- either — mon_detect_aqarmonthly_card_district_drift (2 limbs, the watchdog for repair
-- 20260927201934, whose canonical SQL is still in the unmerged PR #4995), mon_detect_district_bridge_leak
-- (2), mon_detect_dead_qa_oracle_wrapper (1), mon_detect_inactive_still_searchable (1, the BLIND limb)
-- and mon_detect_wasalt_dead_but_active (1, the BLIND limb). Touching a function whose source lives in
-- an open PR would fight that merge queue, and each needs its own raise-path proof. Tracked separately.
create or replace function public.mon_detect_aqarmonthly_street_as_district()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n        int := 0;
  live     text[] := '{}';
  k        text := 'aqarmonthly_street_as_district';   -- a VARIABLE, not a bare literal: see above
  v_fresh  timestamptz;
  v_raw    int;
  v_idx    int;
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

  -- LIMB 1 — the raw table, both the indexed column and the one the card renders.
  select count(*) into v_raw
    from public.aqarmonthly_residential_listings
   where district_ar ~ '^حي (شارع|طريق|ممر)'
      or neighborhood ~ '^حي (شارع|طريق|ممر)';

  if v_raw > 0 then
    select jsonb_agg(s) into v_sample
      from (
        select jsonb_build_object('ad_number', ad_number, 'active', active,
                                  'district_ar', district_ar, 'card_shows', neighborhood,
                                  'listing_url', listing_url) as s
          from public.aqarmonthly_residential_listings
         where district_ar ~ '^حي (شارع|طريق|ممر)'
            or neighborhood ~ '^حي (شارع|طريق|ممر)'
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

  -- LIMB 2 — the SERVED index. district_ar reaches users through listing_native_location_v1 →
  -- search_listings_ar, and a repair that never reached the index is a repair the user cannot see.
  select count(*) into v_idx
    from public.search_listings_ar
   where source_table = 'aqarmonthly_residential_listings'
     and district_ar ~ '^حي (شارع|طريق|ممر)';

  if v_idx > 0 then
    live := live || (k || ':index');
    n := n + public.mon_raise('P2', k, 'aqarmonthly', k || ':index',
      jsonb_build_object(
        'rows', v_idx,
        'raw_rows', v_raw,
        'why', 'The SERVED index carries a street as the district for these listings — this is what '
            || 'real district searches match against and what the district list offers. With '
            || 'raw_rows = 0 the raw table is already clean and only the index is stale.',
        'action', 'If the raw table is clean, refresh the location chain in ORDER: '
            || 'listing_location_index, listing_location_canonical_mv, listing_native_location_v1, '
            || 'then select * from sync_search_listings_ar() and READ the returned row — no row '
            || 'means the writer lock refused it, not that there was nothing to do.'));
  end if;

  perform public.mon_resolve_stale_keys(k, live);
  return n;
end
$function$;

comment on function public.mon_detect_aqarmonthly_street_as_district() is
  'P2 when an aqarmonthly listing stores a street where its district belongs («حي شارع …») — the '
  'standing half of repair 20260927205755. Checks the raw table (district_ar AND the card''s '
  'neighborhood) and the served index separately. BLIND-guarded on aqarmonthly runs.';
