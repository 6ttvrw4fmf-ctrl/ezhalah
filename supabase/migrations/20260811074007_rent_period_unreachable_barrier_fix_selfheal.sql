-- Corrects two defects in the body shipped minutes earlier by 20260811_rent_period_unreachable_barrier:
--   1. mon_resolve_key takes (p_kind, p_dedup) — it was called with one argument, so the ZERO-count
--      self-heal branch would have raised undefined_function. That is the branch that only executes
--      once the defect is actually fixed, so the barrier would have crashed precisely when it was
--      supposed to go green, and surfaced as detector_crash instead of resolving.
--   2. the row total was computed twice (the first aggregate counted platform GROUPS, not rows, and
--      was then silently overwritten). Correct either way, but a barrier has to be readable.
-- Both paths are exercised by the DO block below against real production state.
create or replace function public.mon_detect_rent_period_unreachable()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  total bigint := 0;
  by_platform jsonb := '{}'::jsonb;
  n int := 0;
begin
  select coalesce(sum(c), 0), coalesce(jsonb_object_agg(platform, c), '{}'::jsonb)
    into total, by_platform
  from (
    select platform, count(*) c
    from public.search_listings_ar
    where deal_ar = 'إيجار'
      and (price_annual is not null or price_total is not null)
      and (rent_period_ar is null or rent_period_ar not in ('سنوي','شهري'))
    group by platform
  ) t(platform, c);

  if total > 0 then
    n := public.mon_raise('P2', 'rent_period_unreachable', 'all',
      'rent_period_unreachable',
      jsonb_build_object(
        'unreachable_priced_rent_rows', total,
        'by_platform', by_platform,
        'why', 'Priced Rent listings whose rent_period_ar is neither «سنوي» nor «شهري». They sit in '
               'search_listings_ar and are counted as searchable, but the annual and monthly Filter '
               'branches both exclude them — a user only reaches them with no period chip set. '
               'Do NOT fix by defaulting the period: that would invent a source fact. Re-enrich the '
               'row so the period comes from the platform (aqar: scrapers/aqar/recover_stubs.py), '
               'or confirm the source genuinely publishes no period and record it.'));
  else
    perform public.mon_resolve_key('rent_period_unreachable', 'rent_period_unreachable');
  end if;

  return n;
end $function$;

do $$
declare
  live_total bigint;
  raised int;
begin
  select count(*) into live_total from public.search_listings_ar
   where deal_ar = 'إيجار'
     and (price_annual is not null or price_total is not null)
     and (rent_period_ar is null or rent_period_ar not in ('سنوي','شهري'));

  -- the >0 path: must raise or dedup without error, and must not crash
  raised := public.mon_detect_rent_period_unreachable();
  raise notice 'rent_period_unreachable: % unreachable rows live, detector returned %', live_total, raised;

  -- the =0 self-heal path, proven for real rather than assumed: call mon_resolve_key with the exact
  -- (kind, dedup_key) pair the detector uses. This is what crashed in the first version.
  perform public.mon_resolve_key('rent_period_unreachable', 'rent_period_unreachable');

  -- and the alert must come straight back on the next sweep while the rows are still unreachable
  if live_total > 0 then
    if public.mon_detect_rent_period_unreachable() = 0
       and not exists (select 1 from public.alert_event
                        where dedup_key = 'rent_period_unreachable' and resolved_at is null) then
      raise exception 'detector failed to re-raise after self-heal while % rows are still unreachable', live_total;
    end if;
  end if;
end $$;
