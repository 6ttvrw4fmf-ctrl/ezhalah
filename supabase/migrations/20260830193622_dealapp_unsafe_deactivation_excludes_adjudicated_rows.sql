-- Third consumer of "was this row adjudicated", third time the answer was one ledger short.
--
-- mon_detect_dealapp_deactivation_on_unreliable_fetch() counts EVERY dealapp row deactivated in
-- the last 24h and, when dealapp's fetch-failure rate is above the floor, calls them unsafe
-- removals. Right now the only dealapp rows deactivated in that window are the 3 res/com
-- URL-collision retractions from 20260830140110 (DA499170, DA549199, DA540978) -- adjudicated,
-- evidenced, and nothing to do with an unreliable fetch. The alert is a false positive, and it is
-- the same shape as the two 20260830193119 fixed: a consumer written before
-- ops_res_com_collision_adjudication existed.
--
-- Its real subject is unchanged and still worth alerting on: a row removed BECAUSE we could not
-- see it, while we are known to be unable to see it. An adjudicated retraction was not removed for
-- that reason, so excluding it does not weaken the guard -- it stops the guard from crying wolf on
-- the one deactivation class that carries recorded evidence.
create or replace function public.mon_detect_dealapp_deactivation_on_unreliable_fetch()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- Above this share of attempted fetches failing, the "not seen at source" signal is not
  -- trustworthy enough for ANY removal decision. Measured rate is ~0.75; 0.30 leaves wide room
  -- for a genuinely-recovered fetch to stop arming this without needing a code change.
  c_shell_rate_floor numeric := 0.30;
  c_window           interval := interval '26 hours';   -- one daily cycle plus slack

  v_attempted bigint; v_failed bigint; v_rate numeric;
  v_deact bigint; v_sample jsonb;
  n int := 0;
begin
  select coalesce(sum((substring(notes from 'attempted=([0-9]+)'))::bigint), 0),
         coalesce(sum((substring(notes from 'fetch_fail_total=([0-9]+)'))::bigint), 0)
    into v_attempted, v_failed
    from public.scrape_runs
   where platform like 'dealapp%'
     and started_at > now() - c_window;

  -- No dealapp run in the window at all: mon_detect_silent_scraper_death and the coverage
  -- detectors own that case. Saying nothing here is correct -- but do not leave a stale alert lit.
  if v_attempted = 0 then
    perform public.mon_resolve_key('dealapp_unsafe_deactivation',
                                   'dealapp_deactivation_on_unreliable_fetch');
    return 0;
  end if;

  v_rate := round(v_failed::numeric / v_attempted, 4);

  select count(*), coalesce(jsonb_agg(jsonb_build_object(
           'ad_number', ad_number, 'deactivated_at', deactivated_at,
           'missing_count', missing_count, 'last_seen_at', last_seen_at) order by deactivated_at desc), '[]'::jsonb)
    into v_deact, v_sample
    from (
      select d.ad_number, d.deactivated_at, d.missing_count, d.last_seen_at
        from public.dealapp_residential_listings d
       where d.deactivated_at > now() - interval '24 hours'
         -- A recorded adjudication is a REASON, not an unexplained removal. Read the union view,
         -- never a single ledger: this detector predates ops_res_com_collision_adjudication and
         -- flagged all 3 of its dealapp retractions as unsafe (2026-08-30).
         and not exists (select 1 from public.ops_adjudicated_listing j
                          where j.tbl = 'dealapp_residential_listings' and j.listing_id = d.id)
      union all
      select d.ad_number, d.deactivated_at, d.missing_count, d.last_seen_at
        from public.dealapp_commercial_listings d
       where d.deactivated_at > now() - interval '24 hours'
         and not exists (select 1 from public.ops_adjudicated_listing j
                          where j.tbl = 'dealapp_commercial_listings' and j.listing_id = d.id)
       limit 20) d;

  if v_rate > c_shell_rate_floor and v_deact > 0 then
    n := n + public.mon_raise('P1', 'dealapp_unsafe_deactivation', 'dealapp',
      'dealapp_deactivation_on_unreliable_fetch',
      jsonb_build_object(
        'deactivated_last_24h', v_deact,
        'fetch_fail_rate', v_rate,
        'attempted', v_attempted,
        'failed', v_failed,
        'threshold', c_shell_rate_floor,
        'sample', v_sample,
        'why', 'dealapp listings were DEACTIVATED while the dealapp fetch is known-unreliable. '
               'Measured 2026-08-26: dealapp serves a permanently listing-less page to GitHub '
               'Actions egress for 78-83% of its own sitemap ids, while an ordinary network gets '
               'the full schema for ~89% of the same ids at the same moment. So "not seen at '
               'source" is ~75% FALSE NEGATIVE and is NOT evidence a listing is gone. '
               'Adjudicated retractions are excluded from this count -- they carry a recorded '
               'reason and were not removed for not being seen.',
        'action', 'Do NOT confirm these removals from last_seen_at, age, or a shell response. '
               'Re-fetch each ad_number from an ordinary network and keep only the ones that '
               'genuinely carry no real-estate-listing key. Then find what deactivated them: the '
               'expected guard is prune_unseen''s 0.80 coverage floor (PRUNE_MIN_COVERAGE), which '
               'should trip nightly at ~25% real coverage. If it was lowered or bypassed, restore '
               'it before reactivating.',
        'evidence', 'docs/ops/DEALAPP_FETCH_EGRESS_FINDING.md'));
  else
    perform public.mon_resolve_key('dealapp_unsafe_deactivation',
                                   'dealapp_deactivation_on_unreliable_fetch');
  end if;

  return n;
end $function$;

do $verify$
declare v int;
begin
  -- The 3 adjudicated retractions are the only dealapp deactivations in the window, so the
  -- detector must now come back clean. If it does not, something ELSE deactivated dealapp rows
  -- and the alert is real -- which is exactly what this detector is for.
  v := public.mon_detect_dealapp_deactivation_on_unreliable_fetch();
  raise notice 'dealapp_unsafe_deactivation raised % (expected 0 -- only adjudicated retractions in window)', v;
end $verify$;