-- The repair of 2026-09-27 (20260927205755) claims an invariant; this is what keeps claiming it.
--
-- The claim: no aqarmonthly listing stores a STREET as its district. Aqar's URI slug prefixes an
-- empty district label «حي» onto the street segment whenever the ad names no district
-- («حي ، شارع ابن هلال الفلالي ، حي الرمال ، …» → «حي-شارع-ابن-هلال-الفلالي-حي-الرمال-…»), and
-- resolve_slug() used to capture that street. 34 active rows were served — and rendered on the card —
-- with the word "street" where the district belongs, 2 of them as the bare «حي شارع».
--
-- Why an unwatched repair is not enough in this exact table. The district-suffix repair of
-- 20260721104637 was retracted by the next re-scrape, and 38 rows were dirty again by 2026-08-22
-- because the forward fix had shipped without two of the backfill's rules. The forward fix here is in
-- scrapers/common/arabic_location.py and pinned by 8 executed cases in
-- scrapers/common/tests/test_aqarmonthly_resolve_slug_district_suffix.py — but a unit test pins the
-- parser against the slugs we have SEEN. Only production can tell us Aqar has started labelling
-- something else with an empty «حي», and only on both surfaces: `district_ar` feeds
-- listing_native_location_v1 → search_listings_ar, while `neighborhood` is what ResultCard renders
-- verbatim for an Arabic-raw platform (owner 2026-07-06). Either one alone reads clean while the
-- other is wrong — that is precisely how this defect survived PR #4995.
--
-- The marker list is deliberately NOT broader than the parser's. «مخطط» is excluded on evidence:
-- «حي مخطط المحمدية» and «حي مخطط الدخل المحدود» are districts Aqar itself publishes in a dedicated
-- district URL segment, on 313 aqar_* rows measured 2026-09-27. Adding it here would make this
-- detector cry wolf over 313 correct rows. If a NEW street label ever appears, it arrives as a new
-- district shape in the index — adjudicate it against the listing's own `address` field before
-- extending either list, and extend BOTH together (parser and detector are one algorithm).
create or replace function public.mon_detect_aqarmonthly_street_as_district()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n        int := 0;
  live     text[] := '{}';
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
    live := live || 'aqarmonthly_street_as_district:BLIND';
    n := n + public.mon_raise('P2', 'aqarmonthly_street_as_district', 'aqarmonthly',
      'aqarmonthly_street_as_district:BLIND',
      jsonb_build_object(
        'blind', true,
        'last_ok_run', v_fresh,
        'why', 'This detector proves no aqarmonthly listing stores a street as its district. The '
            || 'corruption it watches for is written by a scrape, so with no successful aqarmonthly '
            || 'run in 7 days a 0 here proves nothing.',
        'action', 'Fix the crawl first (.github/workflows/aqarmonthly-sync.yml).'));
    perform public.mon_resolve_stale_keys('aqarmonthly_street_as_district', live);
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

    live := live || 'aqarmonthly_street_as_district';
    n := n + public.mon_raise('P2', 'aqarmonthly_street_as_district', 'aqarmonthly',
      'aqarmonthly_street_as_district',
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
    live := live || 'aqarmonthly_street_as_district:index';
    n := n + public.mon_raise('P2', 'aqarmonthly_street_as_district', 'aqarmonthly',
      'aqarmonthly_street_as_district:index',
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

  perform public.mon_resolve_stale_keys('aqarmonthly_street_as_district', live);
  return n;
end
$function$;

comment on function public.mon_detect_aqarmonthly_street_as_district() is
  'P2 when an aqarmonthly listing stores a street where its district belongs («حي شارع …») — the '
  'standing half of repair 20260927205755. Checks the raw table (district_ar AND the card''s '
  'neighborhood) and the served index separately. BLIND-guarded on aqarmonthly runs.';

-- A detector outside mon_run_all_detectors() is decoration: mon_detect_orphaned_detectors() fires on
-- any detector nothing reaches, and AGENTS.md requires the wrapper and the roster entry in the same
-- change. Idempotent, and it refuses rather than guesses if the anchor is ever renamed.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_aqarmonthly_street_as_district' in src) > 0 then
    raise notice 'mon_detect_aqarmonthly_street_as_district already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_aqarmonthly_card_district_drift'',',
    E'    ''mon_detect_aqarmonthly_card_district_drift'',\n    ''mon_detect_aqarmonthly_street_as_district'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;
