-- mon_detect_dealapp_utilities_trapped (🆕 New Listings Engineer, 2026-10-10).
-- dealapp publishes «utilities» as a structured JSON-LD list; the scraper has written it to the raw
-- table since 2026-10-05 (listed = yes, unlisted = unknown). The residential arm of listing_rich_attrs
-- read NULL for electricity / water_supply / sanitation, so on 2026-10-10 5,599 of 6,650 dealapp
-- residential arrivals in 7 days had a published utility the Advanced Filter could not see, and
-- nothing alerted. Fixed by 20261010073234; this watches newly arrived rows so it cannot recur
-- silently. Two findings: a raw «yes» that search does not serve (P2), and a search «no» where the
-- raw table is silent (P1 — a positive-only list must never become «no»).
create or replace function public.mon_detect_dealapp_utilities_trapped()
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
  with r as (
    select s.source_table, s.listing_id,
           s.electricity se, s.water_supply sw, s.sanitation ss,
           x.electricity re, x.water_supply rw, x.sanitation rs
      from public.search_listings_ar s
      join public.dealapp_residential_listings x
        on s.source_table = 'dealapp_residential_listings' and x.id = s.listing_id
     where s.source_table = 'dealapp_residential_listings'
       and s.first_seen_at > now() - interval '7 days' and s.first_seen_at < now() - interval '2 hours'
    union all
    select s.source_table, s.listing_id, s.electricity, s.water_supply, s.sanitation,
           x.electricity, x.water_supply, x.sanitation
      from public.search_listings_ar s
      join public.dealapp_commercial_listings x
        on s.source_table = 'dealapp_commercial_listings' and x.id = s.listing_id
     where s.source_table = 'dealapp_commercial_listings'
       and s.first_seen_at > now() - interval '7 days' and s.first_seen_at < now() - interval '2 hours'
  )
  select count(*),
         count(*) filter (where (re is true and se is not true) or (rw is true and sw is not true)
                             or (rs is true and ss is not true)),
         count(*) filter (where (se is false and re is null) or (sw is false and rw is null)
                             or (ss is false and rs is null)),
         (select jsonb_agg(jsonb_build_object('t', source_table, 'id', listing_id,
                    'raw', jsonb_build_array(re, rw, rs), 'search', jsonb_build_array(se, sw, ss)))
            from (select * from r
                   where (re is true and se is not true) or (rw is true and sw is not true)
                      or (rs is true and ss is not true) or (se is false and re is null)
                      or (sw is false and rw is null) or (ss is false and rs is null)
                   limit 10) z)
    into v_recent, v_trap, v_false, v_sample
    from r;

  -- BLINDNESS GUARD: with no new dealapp arrivals a 0 proves nothing.
  if v_recent = 0 then
    live := live || 'dealapp_utilities_trapped:BLIND'::text;
    n := n + public.mon_raise('P2', 'dealapp_utilities_trapped', 'dealapp',
      'dealapp_utilities_trapped:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No dealapp listing arrived in 7 days, so this detector cannot see whether its '
            || 'utilities still reach search.',
        'action', 'Fix the dealapp crawl first.'));
    perform public.mon_resolve_stale_keys('dealapp_utilities_trapped', live);
    return n;
  end if;

  if v_trap > 0 then
    live := live || 'dealapp_utilities_trapped:trapped'::text;
    n := n + public.mon_raise('P2', 'dealapp_utilities_trapped', 'dealapp',
      'dealapp_utilities_trapped:trapped',
      jsonb_build_object('rows', v_trap, 'of', v_recent, 'sample', v_sample,
        'why', 'dealapp lists electricity/water/sewage in its structured utilities but search serves unknown.',
        'action', 'Check the dealapp arms of listing_rich_attrs (20261010073234) and job 28 (:22).'));
  end if;
  if v_false > 0 then
    live := live || 'dealapp_utilities_trapped:false_from_silence'::text;
    n := n + public.mon_raise('P1', 'dealapp_utilities_trapped', 'dealapp',
      'dealapp_utilities_trapped:false_from_silence',
      jsonb_build_object('rows', v_false, 'of', v_recent, 'sample', v_sample,
        'why', 'A positive-only utilities list produced a "no": unknown became no.',
        'action', 'The dealapp arms must yield true or NULL, never false out of silence.'));
  end if;

  perform public.mon_resolve_stale_keys('dealapp_utilities_trapped', live);
  return n;
end
$function$;

-- Roster entry in the same change (AGENTS.md): a detector nothing reaches is decoration.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_dealapp_utilities_trapped' in src) > 0 then
    raise notice 'mon_detect_dealapp_utilities_trapped already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_dwelleo_amenity_trapped'',',
    E'    ''mon_detect_dwelleo_amenity_trapped'',\n    ''mon_detect_dealapp_utilities_trapped'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Check (executes the detector): it must run without error and, before the 08:22 sync carries
-- 20261010073234 into search, it must SEE the trapped rows (a detector that reads 0 here is blind).
do $c$
declare r int; k int;
begin
  r := public.mon_detect_dealapp_utilities_trapped();
  select count(*) into k from public.alert_event
   where kind = 'dealapp_utilities_trapped' and resolved_at is null;
  if k = 0 then raise exception 'detector ran (returned %) but raised nothing while rows are trapped', r; end if;
  if position('mon_detect_dealapp_utilities_trapped' in
              pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'detector is not on the roster';
  end if;
end $c$;
