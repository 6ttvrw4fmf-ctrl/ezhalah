-- 🆕 New Listings Engineer 2026-11-05 — ARRIVALS lose their pin / licence and nothing sees it (blind spot, owner 11-04 order).
-- Measured 07:20 UTC: wasalt's 2,091 arrivals of 2026-11-04 serve a map pin on 13.9% and a REGA licence on 14.5%
-- (every other day: 100% / 99.5–100%). 1,800 arrived in one 90-minute burst (21:10–22:41 UTC); their pin and licence
-- live only on the Arabic page, fetched by wasalt-enrich-ar.yml, which clears ~350 rows per 45-minute run and ran only
-- at 05:30 and 17:30 UTC (05:30 run 41974373524: ok=350, 1,650 left). pin_coverage_by_platform() judges a platform over
-- ALL its served ads (wasalt ~100k), so 1,800 pinless arrivals never moved it below the 95% floor.
-- (1) ROOT: enrich-AR every 4 hours (same rows, fetched sooner — no extra proxy pages; an empty queue ends in seconds).
-- (2) GUARD: arrivals_pin_or_licence_dip — per platform, the last 24 h of production-ready arrivals (≥ 50) serve a pin
--     below the platform's declared floor, or a licence on under half the share its own previous 7 days carried (≥ 90%).
do $cad$
begin
  perform cron.alter_job(job_id := 39, schedule := '30 1,5,9,13,17,21 * * *');
  if (select schedule from cron.job where jobid = 39) <> '30 1,5,9,13,17,21 * * *' then
    raise exception 'enrich-ar cadence did not land';
  end if;
end $cad$;

create or replace function public.arrivals_pin_licence_coverage()
returns table(platform text, arrivals bigint, pin_pct numeric, pin_floor int, lic_pct numeric, lic_pct_7d numeric,
              pin_dip boolean, lic_dip boolean)
language sql stable security definer set search_path to 'public' as $$
  with w as (
    select s.platform, (s.first_seen_at > now() - interval '24 hours') as today,
           (s.latitude is not null) as pin, (s.license_number is not null) as lic
      from public.search_listings_ar s
     where s.production_ready and s.first_seen_at > now() - interval '8 days'),
  g as (
    select w.platform,
           count(*) filter (where today) as arrivals,
           round(100.0 * avg(pin::int) filter (where today), 1) as pin_pct,
           round(100.0 * avg(lic::int) filter (where today), 1) as lic_pct,
           round(100.0 * avg(lic::int) filter (where not today), 1) as lic_pct_7d,
           count(*) filter (where not today) as prior_n
      from w group by w.platform)
  select g.platform, g.arrivals, g.pin_pct, d.floor_pct, g.lic_pct, g.lic_pct_7d,
         g.arrivals >= 50 and d.floor_pct > 1 and d.pin_source <> 'none' and g.pin_pct < d.floor_pct as pin_dip,
         g.arrivals >= 50 and g.prior_n >= 50 and g.lic_pct_7d >= 90 and g.lic_pct < g.lic_pct_7d / 2 as lic_dip
    from g left join public.ops_pin_source_declared d on d.platform = g.platform
   where g.arrivals > 0;
$$;
revoke all on function public.arrivals_pin_licence_coverage() from public, anon, authenticated;
grant execute on function public.arrivals_pin_licence_coverage() to service_role;

create or replace function public.mon_detect_arrivals_pin_or_licence_dip()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rows bigint; v_by jsonb; v_open boolean; r int := 0;
begin
  select count(*), coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'arrivals', arrivals, 'pin_pct', pin_pct,
                                                          'pin_floor', pin_floor, 'lic_pct', lic_pct, 'lic_pct_7d', lic_pct_7d,
                                                          'pin_dip', pin_dip, 'lic_dip', lic_dip) order by arrivals desc), '[]'::jsonb)
    into v_rows, v_by
    from public.arrivals_pin_licence_coverage() where pin_dip or lic_dip;
  v_open := exists (select 1 from public.alert_event where dedup_key = 'arrivals_pin_or_licence_dip' and resolved_at is null);
  if v_rows = 0 then
    if v_open then perform public.mon_resolve('arrivals_pin_or_licence_dip', 'location'); end if;
  elsif not v_open then
    r := public.mon_raise('P2', 'arrivals_pin_or_licence_dip', 'location', 'arrivals_pin_or_licence_dip',
      jsonb_build_object('platforms', v_rows, 'per_platform', v_by, 'for', '🆕',
        'why', 'The last 24 h of a platform''s arrivals serve a map pin below its declared floor, or a REGA licence on under '
            || 'half the share its own previous 7 days carried. The platform-wide pin floor cannot see this (a burst of '
            || 'arrivals is a small slice of a big site). First suspect: the detail/second fetch that carries the pin and '
            || 'licence did not reach the new rows (wasalt: ar_fetched = false → dispatch wasalt-enrich-ar-drain.yml bounded '
            || 'to the burst). Never geocode, never lower a floor to clear this.'));
  end if;
  return r;
end $function$;
revoke all on function public.mon_detect_arrivals_pin_or_licence_dip() from public, anon, authenticated;
grant execute on function public.mon_detect_arrivals_pin_or_licence_dip() to service_role;

do $roster$
declare d text; anchor text := '''mon_detect_pin_coverage_below_floor'','; k int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if d is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position('''mon_detect_arrivals_pin_or_licence_dip''' in d) > 0 then
    raise notice 'already rostered';
  else
    k := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
    if k <> 1 then raise exception 'roster anchor found % times, want 1', k; end if;
    d := replace(d, anchor, '''mon_detect_arrivals_pin_or_licence_dip'', ' || anchor);
    execute d;
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if position('''mon_detect_arrivals_pin_or_licence_dip''' in d) = 0 then raise exception 'roster edit did not land'; end if;
end
$roster$;

-- PROOF, both directions, on today's real data: the wasalt burst IS caught (pin and licence), Property Finder's
-- 4,508 arrivals at ~100% pin / 100% licence are NOT; the detector is rostered, not orphaned.
do $proof$
declare w record; pf record;
begin
  select * into w from public.arrivals_pin_licence_coverage() where platform = 'wasalt';
  if w is null or not (w.pin_dip and w.lic_dip) then
    raise exception 'PROOF: the wasalt arrivals burst (pin % / licence %, 7d %) was not caught', w.pin_pct, w.lic_pct, w.lic_pct_7d;
  end if;
  select * into pf from public.arrivals_pin_licence_coverage() where platform = 'aqar';
  if pf is null or pf.pin_dip or pf.lic_dip then
    raise exception 'PROOF: aqar (pin %, floor %) read as a dip', pf.pin_pct, pf.pin_floor;
  end if;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_arrivals_pin_or_licence_dip') <> 0 then
    raise exception 'PROOF: the detector reads as orphaned';
  end if;
  raise notice 'PROOF OK: wasalt pin % / licence % (7d %) caught; aqar pin % clean; rostered', w.pin_pct, w.lic_pct, w.lic_pct_7d, pf.pin_pct;
end $proof$;
