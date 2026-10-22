-- Wasalt commercial ads show their own map pin (owner 2026-10-21: «whenever we have a district border,
-- suspect a bug on our end, especially the big sites»). He was right. enrich_ar.py stores the Arabic
-- detail page into ar_data for BOTH wasalt tables, and the page's pin sits at ar_data.location.lat/lon.
-- The residential arm of listing_rich_attrs reads that path; the commercial arm still read only
-- additional_info.latitude/lat, which Wasalt never fills. Measured that day: 2,070 served Wasalt
-- commercial ads carried a pin in ar_data and showed the district border instead (e.g. 464405 showroom,
-- Jeddah, 21.5019,39.2392). The hourly sync_all_rich_attrs already includes this table, so the pins
-- reach search at the next :22 run; the shared-default and far-pin guards still apply after that.
-- Same live-viewdef replace as the furnished migration of 2026-10-16, scoped to the commercial arm only.
set local statement_timeout = '5min';
do $m$
declare
  v text; head text; arm text; rest text; p int; q int; i int;
  o_lat text := $q$COALESCE((x.additional_info ->> 'latitude'::text), (x.additional_info ->> 'lat'::text))$q$;
  n_lat text := $q$COALESCE(((x.ar_data -> 'location'::text) ->> 'lat'::text), (x.additional_info ->> 'latitude'::text), (x.additional_info ->> 'lat'::text))$q$;
  o_lng text := $q$COALESCE((x.additional_info ->> 'longitude'::text), (x.additional_info ->> 'lng'::text))$q$;
  n_lng text := $q$COALESCE(((x.ar_data -> 'location'::text) ->> 'lon'::text), (x.additional_info ->> 'longitude'::text), (x.additional_info ->> 'lng'::text))$q$;
begin
  v := pg_get_viewdef('public.listing_rich_attrs'::regclass);
  p := position($q$'wasalt_commercial_listings'::text AS source_table$q$ in v);
  if p = 0 then raise exception 'wasalt commercial arm not found'; end if;
  head := substring(v from 1 for p - 1);
  rest := substring(v from p);
  q := position('FROM wasalt_commercial_listings x' in rest);
  if q = 0 then raise exception 'wasalt commercial FROM not found'; end if;
  arm := substring(rest from 1 for q - 1);
  rest := substring(rest from q);
  if position('ar_data' in arm) > 0 and position(n_lat in arm) > 0 then
    raise notice 'commercial arm already reads ar_data location'; return;
  end if;
  -- each expression appears twice in its CASE (the WHEN test and the THEN value)
  if (length(arm) - length(replace(arm, o_lat, ''))) / length(o_lat) <> 2 then raise exception 'lat anchor count wrong'; end if;
  if (length(arm) - length(replace(arm, o_lng, ''))) / length(o_lng) <> 2 then raise exception 'lng anchor count wrong'; end if;
  arm := replace(replace(arm, o_lat, n_lat), o_lng, n_lng);
  for i in 1..20 loop
    begin
      set local lock_timeout = '3s';
      execute 'create or replace view public.listing_rich_attrs as ' || head || arm || rest;
      exit;
    exception when lock_not_available then
      if i = 20 then raise; end if;
      perform pg_sleep(2);
    end;
  end loop;
end $m$;

-- Barrier: a Wasalt ad (either table) whose own Arabic page carries a pin must get it from the view.
create or replace function public.mon_detect_wasalt_page_pin_not_read()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; live text[] := '{}'; v_seen bigint; v_drop bigint;
begin
  if not public.mon_claim_daily_slot('mon_detect_wasalt_page_pin_not_read') then
    return 0;
  end if;
  select count(*) into v_seen from (
    select 1 from public.wasalt_residential_listings w where w.active and w.ar_data -> 'location' ->> 'lat' ~ '^-?[0-9.]+$'
    union all
    select 1 from public.wasalt_commercial_listings x where x.active and x.ar_data -> 'location' ->> 'lat' ~ '^-?[0-9.]+$') s;
  select count(*) into v_drop from (
    select 1 from public.listing_rich_attrs r join public.wasalt_residential_listings w on w.id = r.listing_id
     where r.source_table = 'wasalt_residential_listings' and r.latitude is null and w.ar_data -> 'location' ->> 'lat' ~ '^-?[0-9.]+$'
    union all
    select 1 from public.listing_rich_attrs r join public.wasalt_commercial_listings x on x.id = r.listing_id
     where r.source_table = 'wasalt_commercial_listings' and r.latitude is null and x.ar_data -> 'location' ->> 'lat' ~ '^-?[0-9.]+$') d;
  if v_seen = 0 then
    live := live || 'wasalt_page_pin_not_read:BLIND'::text;
    n := n + public.mon_raise('P2', 'wasalt_page_pin_not_read', 'wasalt', 'wasalt_page_pin_not_read:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No active Wasalt row carries ar_data.location, so this detector cannot see a dropped pin.',
        'action', 'Check scrapers/wasalt/enrich_ar.py still stores the Arabic page into ar_data.'));
  elsif v_drop > 0 then
    live := live || 'wasalt_page_pin_not_read:dropped'::text;
    n := n + public.mon_raise('P1', 'wasalt_page_pin_not_read', 'wasalt', 'wasalt_page_pin_not_read:dropped',
      jsonb_build_object('rows', v_drop, 'page_pins', v_seen,
        'why', 'The Wasalt ad page has a pin in ar_data.location but listing_rich_attrs answers NULL, so the ad shows a district border instead of its pin.',
        'action', 'Both wasalt arms of listing_rich_attrs must read ar_data -> location ->> lat/lon.'));
  end if;
  perform public.mon_resolve_stale_keys('wasalt_page_pin_not_read', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_wasalt_page_pin_not_read' in src) > 0 then return; end if;
  out_def := replace(src,
    E'    ''mon_detect_wasalt_structured_furnished_dropped'',',
    E'    ''mon_detect_wasalt_structured_furnished_dropped'',\n    ''mon_detect_wasalt_page_pin_not_read'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- Proof: no active Wasalt commercial row with a page pin answers NULL from the view.
do $proof$
begin
  if exists (select 1 from public.listing_rich_attrs r join public.wasalt_commercial_listings x on x.id = r.listing_id
              where r.source_table = 'wasalt_commercial_listings' and r.latitude is null
                and x.ar_data -> 'location' ->> 'lat' ~ '^-?[0-9.]+$') then
    raise exception 'PROOF: a wasalt commercial page pin still reads NULL';
  end if;
end $proof$;
