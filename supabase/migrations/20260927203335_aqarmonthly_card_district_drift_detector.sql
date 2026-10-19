-- The repair of 2026-09-27 (20260927201934) claims an invariant; this is what keeps claiming it.
--
-- The claim: on aqarmonthly, the district the CARD renders (`neighborhood`, which ResultCard prefers
-- verbatim whenever it is Arabic — owner rule 2026-07-06) is the same district the SEARCH INDEX is
-- built from (`district_ar`). Two columns, one parse.
--
-- Why an unwatched repair is not enough here, in this exact table. Migration 20260721104637 repaired
-- 1,015 aqarmonthly districts whose city name had been glued on by the delimiter-less source slug,
-- shipped no detector, and the parser guard that was meant to hold the line implemented a WEAKER
-- rule than the repair — so every re-scrape quietly re-corrupted rows it had just fixed, for a
-- month, unnoticed. That incident is the reason verify-repair-migrations-are-guarded.ts exists. The
-- 2026-09-27 repair fixes the very same class one column over, so it gets the standing check the
-- 2026-07-21 one lacked: if map_listing() ever again derives the card's district from a second,
-- weaker parse, this fires on the next scrape instead of a month later.
create or replace function public.mon_detect_aqarmonthly_card_district_drift()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n     int := 0;
  live  text[] := '{}';
  v_fresh timestamptz;
  v_bad int;
  v_sample jsonb;
begin
  -- BLINDNESS GUARD (AGENTS.md: a monitor that cannot see is not a clean bill). The drift this
  -- watches is re-introduced by a SCRAPE, so "0 drifted rows" only means something while
  -- aqarmonthly is actually running. If it has stalled, say BLIND rather than return a healthy 0.
  select max(finished_at) into v_fresh
    from public.scrape_runs
   where platform = 'aqarmonthly' and ok;

  if v_fresh is null or v_fresh < now() - interval '7 days' then
    live := live || 'aqarmonthly_card_district_drift:BLIND';
    n := n + public.mon_raise('P2', 'aqarmonthly_card_district_drift', 'aqarmonthly',
      'aqarmonthly_card_district_drift:BLIND',
      jsonb_build_object(
        'blind', true,
        'last_ok_run', v_fresh,
        'why', 'This detector proves the aqarmonthly card district still equals the indexed '
            || 'district. The drift it watches for is written by a scrape, so with no successful '
            || 'aqarmonthly run in 7 days a 0 here proves nothing.',
        'action', 'Fix the crawl first (.github/workflows/aqarmonthly-sync.yml).'));
    perform public.mon_resolve_stale_keys('aqarmonthly_card_district_drift', live);
    return n;
  end if;

  select jsonb_agg(s) into v_sample
    from (
      select jsonb_build_object('ad_number', ad_number,
                                'card_shows', neighborhood,
                                'index_has', district_ar) as s
        from public.aqarmonthly_residential_listings
       where active
         and neighborhood is distinct from district_ar
       order by id
       limit 10
    ) t;

  select count(*) into v_bad
    from public.aqarmonthly_residential_listings
   where active and neighborhood is distinct from district_ar;

  if v_bad > 0 then
    live := live || 'aqarmonthly_card_district_drift';
    n := n + public.mon_raise('P2', 'aqarmonthly_card_district_drift', 'aqarmonthly',
      'aqarmonthly_card_district_drift',
      jsonb_build_object(
        'rows', v_bad,
        'sample', v_sample,
        'why', 'ResultCard renders the RAW scraped district (`neighborhood`) whenever it is Arabic, '
            || 'so these listings show a user a different district than the one search matched them '
            || 'on (`district_ar`, which search_listings_ar is built from). That is the 2026-09-21 '
            || 'live bug: cards reading «بدر الرياض منطقة» while the index said «حي بدر».',
        'action', 'scrapers/aqarmonthly/run.py map_listing() must write ONE parsed district into '
            || 'both columns (district_ar_val). If it has grown a second parse again, that is the '
            || 'regression — do not repair the rows without fixing the writer first.'));
  end if;

  perform public.mon_resolve_stale_keys('aqarmonthly_card_district_drift', live);
  return n;
end
$function$;

comment on function public.mon_detect_aqarmonthly_card_district_drift() is
  'P2 when an active aqarmonthly row''s card district (neighborhood) differs from the indexed one '
  '(district_ar) — the standing half of repair 20260927201934. BLIND-guarded on aqarmonthly runs.';

-- A detector outside mon_run_all_detectors() is decoration: mon_detect_orphaned_detectors() fires
-- on any detector nothing reaches, and AGENTS.md requires the wrapper and the roster entry in the
-- same change. Idempotent, and it refuses rather than guesses if the anchor is ever renamed.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_aqarmonthly_card_district_drift' in src) > 0 then
    raise notice 'mon_detect_aqarmonthly_card_district_drift already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_aqarmonthly_district_city_suffix'',',
    E'    ''mon_detect_aqarmonthly_district_city_suffix'',\n    ''mon_detect_aqarmonthly_card_district_drift'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;
