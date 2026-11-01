-- 🔬 AF engineer 2026-10-10 (backlog 296): Gathern's manufactured «no» answers back to unknown.
--
-- Gathern's feature list names only what a unit HAS and never prints a no (scrapers/gathern/run.py
-- _amenity_flags, PR 6545: listed = yes, absent = AUTHORITATIVE_NULL). The parser stopped writing False
-- on 10-09 and the columns default to NULL, but 248 active units outside the monthly feed kept their old
-- False, because the liveness job that keeps them alive never rewrites amenities. Measured before this
-- migration: elevator 93, parking 153, driver_room 247, balcony_terrace 215 stored False, and on not one
-- of those rows does the unit's own stored feature list (additional_info.amenities) carry the label.
-- So each False is silence turned into «no» (ADVANCED_FILTER_SOURCE_TRUTH §2) and goes back to NULL.
-- Only False becomes NULL; a True is never touched. The served index is cleared the same way, so the
-- answer is right before the :22 sync re-derives it.

create or replace function public.mon_detect_gathern_manufactured_no()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n       int := 0;
  live    text[] := '{}';
  v_act   int;
  v_raw   int;
  v_srv   int;
  v_sample jsonb;
begin
  select count(*),
         count(*) filter (where elevator is false or parking is false or driver_room is false
                             or balcony_terrace is false)
    into v_act, v_raw
    from public.gathern_residential_listings where active;
  select count(*) into v_srv from public.search_listings_ar
   where platform = 'gathern' and (elevator is false or parking is false or driver_room is false);

  if v_act = 0 then
    live := live || 'gathern_manufactured_no:BLIND'::text;
    n := n + public.mon_raise('P2', 'gathern_manufactured_no', 'gathern', 'gathern_manufactured_no:BLIND',
      jsonb_build_object('blind', true, 'why', 'No active Gathern unit, so a 0 here proves nothing.'));
    perform public.mon_resolve_stale_keys('gathern_manufactured_no', live);
    return n;
  end if;

  if v_raw > 0 or v_srv > 0 then
    select jsonb_agg(jsonb_build_object('t', 'gathern_residential_listings', 'id', id)) into v_sample
      from (select id from public.gathern_residential_listings
             where active and (elevator is false or parking is false or driver_room is false
                               or balcony_terrace is false)
             limit 10) z;
    live := live || 'gathern_manufactured_no:false'::text;
    n := n + public.mon_raise('P2', 'gathern_manufactured_no', 'gathern', 'gathern_manufactured_no:false',
      jsonb_build_object('raw_rows', v_raw, 'served_rows', v_srv, 'of', v_act, 'sample', v_sample,
        'why', 'Gathern never prints a no, so a stored or served false is silence turned into no.',
        'action', 'Find the writer that produced false, scrapers/gathern/run.py _amenity_flags must yield true or NULL.'));
  end if;

  perform public.mon_resolve_stale_keys('gathern_manufactured_no', live);
  return n;
end
$function$;

-- Roster entry in the same change (AGENTS.md): a detector nothing reaches is decoration.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_gathern_manufactured_no' in src) > 0 then
    raise notice 'mon_detect_gathern_manufactured_no already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_dealapp_utilities_trapped'',',
    E'    ''mon_detect_dealapp_utilities_trapped'',\n    ''mon_detect_gathern_manufactured_no'',');
  if out_def = src then
    raise exception 'roster anchor not found, refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- The detector must SEE the rows before the repair (a detector that reads 0 here is blind).
do $c$
declare k int;
begin
  perform public.mon_detect_gathern_manufactured_no();
  select count(*) into k from public.alert_event
   where kind = 'gathern_manufactured_no' and resolved_at is null and dedup_key = 'gathern_manufactured_no:false';
  if k = 0 then raise exception 'detector raised nothing while manufactured false rows exist'; end if;
end $c$;

-- The repair: False to NULL only, active Gathern units, source and served index.
do $r$
declare e int; p int; d int; b int; s int;
begin
  update public.gathern_residential_listings set elevator = null where active and elevator is false;
  get diagnostics e = row_count;
  update public.gathern_residential_listings set parking = null where active and parking is false;
  get diagnostics p = row_count;
  update public.gathern_residential_listings set driver_room = null where active and driver_room is false;
  get diagnostics d = row_count;
  update public.gathern_residential_listings set balcony_terrace = null where active and balcony_terrace is false;
  get diagnostics b = row_count;
  if e > 200 or p > 300 or d > 400 or b > 400 then
    raise exception 'repair touched more rows than measured, elevator % parking % driver % balcony %', e, p, d, b;
  end if;
  update public.search_listings_ar
     set elevator    = case when elevator is false then null else elevator end,
         parking     = case when parking is false then null else parking end,
         driver_room = case when driver_room is false then null else driver_room end
   where platform = 'gathern' and (elevator is false or parking is false or driver_room is false);
  get diagnostics s = row_count;
  raise notice 'gathern manufactured no to NULL: elevator %, parking %, driver %, balcony %, served rows %', e, p, d, b, s;
end $r$;

-- Check: nothing false is left, and the detector now resolves its own alert.
do $c2$
declare k int;
begin
  if exists (select 1 from public.gathern_residential_listings
              where active and (elevator is false or parking is false or driver_room is false
                                or balcony_terrace is false)) then
    raise exception 'manufactured false rows remain after the repair';
  end if;
  perform public.mon_detect_gathern_manufactured_no();
  select count(*) into k from public.alert_event
   where kind = 'gathern_manufactured_no' and resolved_at is null and dedup_key = 'gathern_manufactured_no:false';
  if k <> 0 then raise exception 'detector still reports manufactured false after the repair'; end if;
end $c2$;
