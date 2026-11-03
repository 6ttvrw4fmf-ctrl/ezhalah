-- gathern_manufactured_no watches what it repairs, and tells a manufactured «no» from one the ad states (2026-11-02).
--
-- Two blind spots, both measured 2026-11-02 while the alert had been open since 10-14:
--  1. It counted ACTIVE raw rows only. 20261010094504's repair was also active-only, so ~15k hidden rows kept the
--     old parser's False (driver_room 14,964 …) and 8 came back active carrying it. A reservoir it never saw.
--     It now counts every raw row, active or not; the sample still prefers active rows.
--  2. It counted every served False. The 49 served «no elevator» on gathern are the ad's OWN words via the
--     text-facts overlay (731077 «ولا يوجد مصعد», 791752 «لايوجد مصعد» …) — source-stated, not silence. A served
--     False now counts only when the overlay does not carry that same «no» with a quote.
-- Same key, same severity; it still fires on any raw False and on any served False the ad never stated.
create or replace function public.mon_detect_gathern_manufactured_no()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n        int := 0;
  live     text[] := '{}';
  v_act    int;
  v_raw    int;
  v_raw_on int;
  v_srv    int;
  v_sample jsonb;
begin
  select count(*) filter (where active),
         count(*) filter (where elevator is false or parking is false or driver_room is false or balcony_terrace is false),
         count(*) filter (where active and (elevator is false or parking is false or driver_room is false or balcony_terrace is false))
    into v_act, v_raw, v_raw_on
    from public.gathern_residential_listings;
  -- a served «no» is manufactured unless the ad's own words say it (text-facts overlay, with its quote)
  select count(*) into v_srv
    from public.search_listings_ar s
    left join public.listing_text_facts f on f.source_table = s.source_table and f.listing_id = s.listing_id
   where s.platform = 'gathern'
     and (   (s.elevator    is false and not (coalesce(f.facts->'elevator'->>'v', '')    = 'false' and coalesce(f.facts->'elevator'->>'q', '')    <> ''))
          or (s.parking     is false and not (coalesce(f.facts->'parking'->>'v', '')     = 'false' and coalesce(f.facts->'parking'->>'q', '')     <> ''))
          or (s.driver_room is false and not (coalesce(f.facts->'driver_room'->>'v', '') = 'false' and coalesce(f.facts->'driver_room'->>'q', '') <> '')));

  if v_act = 0 then
    live := live || 'gathern_manufactured_no:BLIND'::text;
    n := n + public.mon_raise('P2', 'gathern_manufactured_no', 'gathern', 'gathern_manufactured_no:BLIND',
      jsonb_build_object('blind', true, 'why', 'No active Gathern unit, so a 0 here proves nothing.'));
    perform public.mon_resolve_stale_keys('gathern_manufactured_no', live);
    return n;
  end if;

  if v_raw > 0 or v_srv > 0 then
    select jsonb_agg(jsonb_build_object('t', 'gathern_residential_listings', 'id', id, 'active', active)) into v_sample
      from (select id, active from public.gathern_residential_listings
             where elevator is false or parking is false or driver_room is false or balcony_terrace is false
             order by active desc, id limit 10) z;
    live := live || 'gathern_manufactured_no:false'::text;
    n := n + public.mon_raise('P2', 'gathern_manufactured_no', 'gathern', 'gathern_manufactured_no:false',
      jsonb_build_object('raw_rows', v_raw, 'raw_rows_active', v_raw_on, 'served_rows', v_srv, 'of', v_act,
        'sample', v_sample,
        'why', 'Gathern never prints a no, so a stored False (active or hidden — a hidden one comes back on revival) '
            || 'or a served False the ad''s own words do not state is silence turned into no.',
        'action', 'Find the writer that produced false, scrapers/gathern/run.py _amenity_flags must yield true or NULL.'));
  end if;

  perform public.mon_resolve_stale_keys('gathern_manufactured_no', live);
  return n;
end
$function$;
