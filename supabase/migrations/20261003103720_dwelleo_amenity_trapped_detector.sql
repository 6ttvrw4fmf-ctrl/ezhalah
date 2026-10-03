-- Keeps 20261003103539 (dwelleo gym / pool / garden from additional_info.amenities) true on NEWLY
-- scraped listings (🆕 New Listings Engineer, 2026-10-03).
--
-- The claim: every dwelleo listing whose own amenity list names «صالة رياضية» / «حمام سباحة» /
-- «حديقة» is served with gym / pool / garden = true, and no dwelleo row is ever served false for
-- them (a positive-only list cannot say "no"). Before 20261003103539 both dwelleo arms of
-- listing_rich_attrs hard-coded NULL, and 516 / 486 / 922 published values were trapped.
--
-- Scope is the last 7 days of arrivals, older than 2 h (job 28 carries listing_rich_attrs into
-- search_listings_ar hourly, so a younger row is legitimately not synced yet). A view rewrite that
-- drops the CASE lines, or a scraper that stops writing the list, turns this RED on the next sweep.
create or replace function public.mon_detect_dwelleo_amenity_trapped()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n        int := 0;
  live     text[] := '{}';
  v_recent int;
  v_trap   int;
  v_false  int;
  v_sample jsonb;
begin
  select count(*) into v_recent
    from public.search_listings_ar
   where platform = 'dwelleo' and first_seen_at > now() - interval '7 days';

  -- BLINDNESS GUARD: with no new dwelleo arrivals a 0 proves nothing.
  if v_recent = 0 then
    live := live || 'dwelleo_amenity_trapped:BLIND';
    n := n + public.mon_raise('P2', 'dwelleo_amenity_trapped', 'dwelleo',
      'dwelleo_amenity_trapped:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No dwelleo listing arrived in 7 days, so this detector cannot see whether the '
            || 'gym/pool/garden amenities still reach search.',
        'action', 'Fix the dwelleo crawl first.'));
    perform public.mon_resolve_stale_keys('dwelleo_amenity_trapped', live);
    return n;
  end if;

  with r as (
    select s.source_table, s.listing_id, s.gym, s.pool, s.garden, x.additional_info -> 'amenities' a
      from public.search_listings_ar s
      join public.dwelleo_residential_listings x
        on s.source_table = 'dwelleo_residential_listings' and x.id = s.listing_id
     where s.platform = 'dwelleo' and s.first_seen_at > now() - interval '7 days'
       and s.first_seen_at < now() - interval '2 hours'
    union all
    select s.source_table, s.listing_id, s.gym, s.pool, s.garden, x.additional_info -> 'amenities'
      from public.search_listings_ar s
      join public.dwelleo_commercial_listings x
        on s.source_table = 'dwelleo_commercial_listings' and x.id = s.listing_id
     where s.platform = 'dwelleo' and s.first_seen_at > now() - interval '7 days'
       and s.first_seen_at < now() - interval '2 hours'
  )
  select count(*) filter (where (a ? 'صالة رياضية' and gym is not true)
                             or (a ? 'حمام سباحة' and pool is not true)
                             or (a ? 'حديقة' and garden is not true)),
         count(*) filter (where gym = false or pool = false or garden = false),
         (select jsonb_agg(jsonb_build_object('t', source_table, 'id', listing_id, 'gym', gym,
                                              'pool', pool, 'garden', garden, 'amenities', a))
            from (select * from r
                   where (a ? 'صالة رياضية' and gym is not true) or (a ? 'حمام سباحة' and pool is not true)
                      or (a ? 'حديقة' and garden is not true) or gym = false or pool = false or garden = false
                   limit 10) z)
    into v_trap, v_false, v_sample
    from r;

  if v_trap > 0 then
    live := live || 'dwelleo_amenity_trapped:trapped';
    n := n + public.mon_raise('P2', 'dwelleo_amenity_trapped', 'dwelleo',
      'dwelleo_amenity_trapped:trapped',
      jsonb_build_object('rows', v_trap, 'sample', v_sample,
        'why', 'dwelleo names gym/pool/garden in its own amenity list but search serves unknown.',
        'action', 'Check the dwelleo arms of listing_rich_attrs (20261003103539) and job 28.'));
  end if;
  if v_false > 0 then
    live := live || 'dwelleo_amenity_trapped:false_from_silence';
    n := n + public.mon_raise('P1', 'dwelleo_amenity_trapped', 'dwelleo',
      'dwelleo_amenity_trapped:false_from_silence',
      jsonb_build_object('rows', v_false, 'sample', v_sample,
        'why', 'A positive-only amenity list produced a "no": unknown became no.',
        'action', 'The dwelleo arms must yield true or NULL, never false.'));
  end if;

  perform public.mon_resolve_stale_keys('dwelleo_amenity_trapped', live);
  return n;
end
$function$;

-- Roster entry in the same change (AGENTS.md): a detector nothing reaches is decoration.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_dwelleo_amenity_trapped' in src) > 0 then
    raise notice 'mon_detect_dwelleo_amenity_trapped already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_aqarmonthly_street_as_district'',',
    E'    ''mon_detect_aqarmonthly_street_as_district'',\n    ''mon_detect_dwelleo_amenity_trapped'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;
