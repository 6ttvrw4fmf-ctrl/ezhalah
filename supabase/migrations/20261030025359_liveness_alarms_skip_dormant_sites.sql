-- Liveness checking alarms skip DORMANT sites (2026-10-30).
--
-- A dormant site is one whose SOURCE is down at its own end (owner down-rule): its listings are already
-- held out of search (production_ready = false) and it returns by itself on the first crawl that saves
-- rows (reactivate_recovered_dormant_platforms). Measured 2026-10-30: the 5 dormant sites (sadin, senan,
-- snam, almuteb, moftah — 196 listings, all production_ready = false) kept six P1 liveness alarms open and
-- read as «0% checked» in every coverage report. Their ads cannot be checked (the source is gone) and no
-- user can see them, so the alarm only hid the real gaps.
--
-- Not a weakening: every SERVED site is graded exactly as before, and a dormant site is still watched by
-- silent_scraper_death and by the dormant auto-return. The moment a site leaves dormant its ads are graded
-- again on the next sweep.

create or replace function public.ops_platform_is_dormant(p_platform text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_registry pr
                  where pr.platform = p_platform and pr.status = 'dormant');
$$;

create or replace function public.mon_detect_liveness_verification_sla()
returns integer language plpgsql security definer set search_path = public as $function$
declare
  -- A grace DATE, not a grace period counted from "now": a fixed date cannot be reset by a
  -- redeploy, and it is visible in the function body rather than buried in a config row.
  v_active_from date := date '2026-09-13';
  v_floor numeric := 50.0;
  -- SOURCE_LIST_PRESENCE is graded from the first daily crawl after the tier landed (04:22 UTC on
  -- 2026-10-03 stamps it): until then every admitted site reads 0% by construction.
  v_list_tier_from timestamptz := timestamptz '2026-10-03 06:00:00+00';
  v_raised int := 0;
  r record;
begin
  if current_date < v_active_from then
    return 0;   -- verification is still populating; alerting now would only produce noise
  end if;

  for r in
    select platform, strategy, active, verified_in_sla, never_verified, pct_verified_in_sla
      from public.ops_platform_liveness_coverage
     where (strategy in ('DIRECT_REVISIT','CANDIDATE_PLUS_DIRECT')
            or (strategy = 'SOURCE_LIST_PRESENCE' and now() >= v_list_tier_from))
       and active > 0
  loop
    if public.ops_platform_is_dormant(r.platform) then
      -- Source down at its own end; its listings are already out of search (2026-10-30).
      perform public.mon_resolve_key('liveness_verification_sla', 'liveness_sla:' || r.platform);
    elsif coalesce(r.pct_verified_in_sla, 0) < v_floor then
      perform public.mon_raise('P1', 'liveness_verification_sla', r.platform,
        'liveness_sla:' || r.platform,
        jsonb_build_object(
          'platform', r.platform,
          'strategy', r.strategy,
          'active', r.active,
          'verified_in_sla', r.verified_in_sla,
          'never_verified', r.never_verified,
          'pct_verified_in_sla', r.pct_verified_in_sla,
          'floor_pct', v_floor,
          'why', 'active=true is supposed to mean we have recent affirmative evidence this '
              || 'listing is live. On this platform most active rows carry no such evidence '
              || 'inside its own SLA window, so its VERIFICATION SYSTEM is unhealthy -- this is '
              || 'not a statement about its inventory. Do NOT deactivate anything in response: '
              || 'absence of verification is UNKNOWN, never death (owner rule 2026-08-30).',
          'action', 'find why that platform liveness job is not covering its population: not '
              || 'scheduled, quarantined by a trust gate, blocked proxy, or a probe rate too low '
              || 'for the population size.'));
      v_raised := v_raised + 1;
    else
      perform public.mon_resolve_key('liveness_verification_sla', 'liveness_sla:' || r.platform);
    end if;
  end loop;

  return v_raised;
end
$function$;

create or replace function public.mon_detect_liveness_checking_shortfall()
returns integer language plpgsql security definer set search_path = public as $function$
declare
  n int := 0;
  live text[] := '{}';
  r record;
  v_rows jsonb;
  v_pos int;
  v_neg int;
  v_gathern jsonb;
begin
  select count(*) into v_pos from public.ops_liveness_checking_shortfall(
    '[{"platform":"__selftest_stalled","active_rows":100,"sla_hours":24,"probes_24h":0,"probes_7d":50,"shape":"STALLED"}]'::jsonb)
   where injected and shape = 'STALLED';
  select count(*) into v_neg from public.ops_liveness_checking_shortfall('[]'::jsonb) where injected;

  if v_pos <> 1 or v_neg <> 0 then
    return public.mon_raise('P1', 'liveness_checking_predicate_blind', 'all',
      'liveness_checking_predicate_blind',
      jsonb_build_object('why', 'ops_liveness_checking_shortfall() stopped discriminating; its '
                              || 'silence no longer means anything',
                         'got_injected', v_pos, 'got_empty', v_neg));
  end if;

  -- Dormant sites (source down at its own end, listings already out of search) are skipped (2026-10-30).
  select coalesce(jsonb_agg(jsonb_build_object(
           'platform', s.platform, 'shape', s.shape, 'active', s.active_rows,
           'sla_hours', s.sla_hours, 'checked_24h', s.probes_24h,
           'needed_per_day', s.required_per_day, 'pct_of_needed', s.pct_of_required)
         order by s.active_rows desc), '[]'::jsonb)
    into v_rows
    from public.ops_liveness_checking_shortfall() s
   where not s.injected and not public.ops_platform_is_dormant(s.platform);

  select to_jsonb(x) into v_gathern from (
    select s.platform, s.shape, s.active_rows, s.sla_hours, s.probes_24h,
           s.required_per_day, s.pct_of_required
      from public.ops_liveness_checking_shortfall() s
     where not s.injected and s.platform = 'gathern') x;

  if jsonb_array_length(v_rows) > 0 then
    -- ::text is load-bearing, see header.
    live := live || 'liveness_checking_shortfall:fleet'::text;
    n := n + public.mon_raise('P1', 'liveness_checking_shortfall', 'all',
      'liveness_checking_shortfall:fleet',
      jsonb_build_object(
        'platforms_behind', jsonb_array_length(v_rows),
        'rows', v_rows,
        'gathern', coalesce(v_gathern, to_jsonb('gathern is NOT behind its schedule'::text)),
        'why', 'These websites are not re-checking their listings fast enough to complete one full '
            || 'pass inside the SLA they themselves declare. required_per_day = active / '
            || '(sla_hours/24). NEVER_CHECKED = nothing has ever looked at this platform. STALLED = '
            || 'it was being checked and stopped. BEHIND = running at under half the needed rate.',
        'do_not', 'Do NOT clear this by raising a platform''s sla_hours or by lowering a cap. That '
            || 'changes the promise instead of the checking, which LISTING_LIVENESS.md §7 forbids '
            || 'in terms. The fix is checking capacity or rotation fairness — see gathern, whose '
            || '0.4% was caused by a sweep re-probing the same 1,500 rows every run, not by '
            || 'throughput (migration 20260924020545, last_liveness_probe_at).',
        'note', 'last_liveness_probe_at starts NULL everywhere it was just added, so a platform '
            || 'reads NEVER_CHECKED until its checker runs once after 2026-09-24. Read this '
            || 'alert''s trend, not its first firing.'));
  else
    perform public.mon_resolve_stale_keys('liveness_checking_shortfall', '{}'::text[]);
  end if;

  for r in
    select * from public.ops_liveness_checking_shortfall() s
     where not s.injected and s.shape = 'STALLED' and not public.ops_platform_is_dormant(s.platform)
  loop
    live := live || ('liveness_checking_shortfall:' || r.platform)::text;
    n := n + public.mon_raise('P1', 'liveness_checking_stalled', r.platform,
      'liveness_checking_shortfall:' || r.platform,
      jsonb_build_object(
        'active_rows', r.active_rows, 'sla_hours', r.sla_hours,
        'checked_last_24h', r.probes_24h, 'checked_last_7d', r.probes_7d,
        'needed_per_day', r.required_per_day,
        'why', 'This platform WAS having its listings checked within the last 7 days and has '
            || 'checked ZERO in the last 24h. A checker that stops produces no rows for anything to '
            || 'compare, so nothing else in the system notices — that is exactly how wasalt''s '
            || 'enumeration died for seven days while its workflow reported success every run.',
        'action', 'Find why this platform''s liveness job stopped running or stopped selecting '
            || 'rows. Check its workflow schedule, its last runs in scrape_runs, and whether its '
            || 'rotation is stuck behind rows it cannot resolve.',
        'do_not', 'A platform nothing has looked at is UNKNOWN, never dead. Do NOT deactivate or '
            || 'delete anything on account of this alert, and do NOT widen a kill to catch up.'));
  end loop;

  perform public.mon_resolve_stale_keys('liveness_checking_stalled',
    array(select ('liveness_checking_shortfall:' || s.platform)::text
            from public.ops_liveness_checking_shortfall() s
           where not s.injected and s.shape = 'STALLED' and not public.ops_platform_is_dormant(s.platform)));
  return n;
end
$function$;

-- Apply-time proof: a dormant site is recognised, a served one is not.
do $chk$
begin
  if not public.ops_platform_is_dormant('sadin') then
    raise exception 'ops_platform_is_dormant: sadin is dormant in platform_registry but reads not dormant';
  end if;
  if public.ops_platform_is_dormant('aqar') then
    raise exception 'ops_platform_is_dormant: aqar is served but reads dormant';
  end if;
end
$chk$;
