-- 🆕 New Listings Engineer 2026-11-05 — mon_detect_arrivals_pin_or_licence_dip() re-raises EVERY sweep while its
-- condition holds (verify-detectors-reaffirm-open-alerts.ts; alert_reaffirmation): mon_raise() keeps one open row per
-- dedup key, so calling it while open only reaffirms and lets the alert escalate. Same body, guard removed.
create or replace function public.mon_detect_arrivals_pin_or_licence_dip()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_rows bigint; v_by jsonb; r int := 0;
begin
  select count(*), coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'arrivals', arrivals, 'pin_pct', pin_pct,
                                                          'pin_floor', pin_floor, 'lic_pct', lic_pct, 'lic_pct_7d', lic_pct_7d,
                                                          'pin_dip', pin_dip, 'lic_dip', lic_dip) order by arrivals desc), '[]'::jsonb)
    into v_rows, v_by
    from public.arrivals_pin_licence_coverage() where pin_dip or lic_dip;
  if v_rows = 0 then
    perform public.mon_resolve('arrivals_pin_or_licence_dip', 'location');
  else
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

do $proof$
begin
  if position('v_open' in pg_get_functiondef('public.mon_detect_arrivals_pin_or_licence_dip()'::regprocedure)) > 0 then
    raise exception 'the open-alert guard is still in the live body';
  end if;
  if (select count(*) from unnest(public.mon_orphaned_detectors()) o where o = 'mon_detect_arrivals_pin_or_licence_dip') <> 0 then
    raise exception 'the detector reads as orphaned';
  end if;
end $proof$;
