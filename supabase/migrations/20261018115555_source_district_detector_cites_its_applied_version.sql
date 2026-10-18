-- APPLIED 2026-10-18 (owner session). The P1 'why' text of mon_detect_source_district_dropped() cited a hand-picked
-- version for 20261018111622 (verify-migration-references-resolve). The recorded body of 20261018111622 and its mirror
-- were corrected to the version it was applied under; this re-creates the live function from that corrected text so
-- production says the same thing. Behaviour unchanged.
create or replace function public.mon_detect_source_district_dropped()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare v_dropped bigint; v_table jsonb; v_open text; r int := 0;
begin
  with t as (
    select d.platform, sum(d.null_rows) null_rows, sum(d.dropped) dropped, sum(d.blank) blank, sum(d.numbered) numbered,
           sum(d.english) english
    from public.source_district_dropped_rows(interval '3 hours') d group by d.platform
  )
  select coalesce(sum(dropped), 0),
         coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'null_rows', null_rows, 'dropped', dropped, 'blank', blank,
                    'numbered', numbered, 'english', english) order by dropped desc, null_rows desc), '[]'::jsonb)
    into v_dropped, v_table
  from t;
  select severity into v_open from public.alert_event
   where dedup_key = 'source_district_dropped' and resolved_at is null order by created_at desc limit 1;
  if v_dropped = 0 then
    if v_open is not null then perform public.mon_resolve('source_district_dropped', 'location_pipeline'); end if;
  elsif v_open is null then
    r := public.mon_raise('P1', 'source_district_dropped', 'location_pipeline', 'source_district_dropped',
      jsonb_build_object('dropped', v_dropped, 'per_platform', v_table, 'for', '🔧',
        'why', 'The source field names an Arabic district for these live ads and OUR index serves none (older than the 3 h pipeline grace). SOURCE IS TRUTH: district_recovery_value() carries the source word when the catalog has no match, resolved in the served city (20261018081657 → 20261018111622). Check refresh_district_recovery() ran (cron 45/17) and the sync wrote; never fix by hand-NULLing the source. Blank sources: district_blank_unexplained (#7485).'));
  end if;
  return r;
end $function$;
