-- 🔬 AF engineer 2026-10-23 (backlog 794): sadiqeltajer answers the room-list reader cannot produce go back to unknown.
--
-- A probe crawl at 12:10 UTC ran a wider sadiqeltajer reader (the whole description box instead of the «المكونات»
-- row). Its re-read (CI source-reread 39953903446) showed wrong yes answers: 12218009, a plot whose text says
-- «يليه مواقف» (next to a car park), and land ads 12217883, 12217895, 12217905, 12218258 with parking and no
-- parking word on their page. The reader was reverted in PR 8376. An upsert that drops None never clears a True,
-- so the rows keep what it wrote. The live reader (scrapers/sadiqeltajer/run.py) reads only the «المكونات» row,
-- stored as additional_info.components, so a yes whose own row does not name the amenity is not the source's
-- statement. Measured before this migration, all rows of both tables: kitchen 200, AC 47, laundry 29, parking 18,
-- furnished 8, private entrance 6, maid room 4, driver room 2, elevator 2. True to NULL only, never false.

create or replace function public.sadiqeltajer_af_outside_room_list()
returns table (tbl text, id bigint, col text)
language sql stable security definer set search_path to 'public'
as $f$
  with t as (
    select 'sadiqeltajer_residential_listings'::text tbl, r.id, coalesce(r.additional_info->>'components','') c,
           r.kitchen, r.air_conditioner, r.parking, r.furnished, r.maid_room, r.driver_room, r.private_entrance,
           r.laundry_room, r.elevator, r.balcony_terrace
      from public.sadiqeltajer_residential_listings r
    union all
    select 'sadiqeltajer_commercial_listings', r.id, coalesce(r.additional_info->>'components',''),
           r.kitchen, r.air_conditioner, r.parking, r.furnished, r.maid_room, r.driver_room, r.private_entrance,
           r.laundry_room, r.elevator, r.balcony_terrace
      from public.sadiqeltajer_commercial_listings r)
  select tbl, id, x.col from t, lateral (values
      ('kitchen', kitchen and c !~ 'مطبخ'),
      ('air_conditioner', air_conditioner and c !~ 'مكيف|تكييف'),
      ('parking', parking and c !~ 'موقف|مواقف|كراج|جراج'),
      ('furnished', furnished and c !~ 'مفروش|مؤثث'),
      ('maid_room', maid_room and c !~ 'خادم|شغال'),
      ('driver_room', driver_room and c !~ 'سائق'),
      ('private_entrance', private_entrance and c !~ 'مدخل'),
      ('laundry_room', laundry_room and c !~ 'غسيل'),
      ('elevator', elevator and c !~ 'مصعد|مصاعد'),
      ('balcony_terrace', balcony_terrace and c !~ 'بلكون|شرف|تراس')) x(col, bad)
  where x.bad
$f$;
revoke all on function public.sadiqeltajer_af_outside_room_list() from public, anon, authenticated;

create or replace function public.mon_detect_sadiqeltajer_af_outside_room_list()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare n int := 0; v_rows int; v_sample jsonb; live text[] := '{}';
begin
  select count(*), jsonb_agg(jsonb_build_object('t', tbl, 'id', id, 'col', col)) filter (where rn <= 10)
    into v_rows, v_sample
    from (select *, row_number() over () rn from public.sadiqeltajer_af_outside_room_list()) z;
  if v_rows > 0 then
    live := live || 'sadiqeltajer_af_outside_room_list'::text;
    n := n + public.mon_raise('P2', 'sadiqeltajer_af_outside_room_list', 'sadiqeltajer', 'sadiqeltajer_af_outside_room_list',
      jsonb_build_object('rows', v_rows, 'sample', v_sample, 'for', '🔬',
        'why', 'A sadiqeltajer Advanced Filter yes that its own «المكونات» row does not name: the live reader reads only that row.',
        'action', 'Find the writer (a wider reader, a probe crawl); the value goes back to NULL unless the room list states it.'));
  end if;
  perform public.mon_resolve_stale_keys('sadiqeltajer_af_outside_room_list', live);
  return n;
end
$function$;
revoke all on function public.mon_detect_sadiqeltajer_af_outside_room_list() from public, anon, authenticated;

-- Roster entry in the same change: a detector nothing reaches is decoration.
do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_sadiqeltajer_af_outside_room_list' in src) > 0 then return; end if;
  out_def := replace(src,
    E'    ''mon_detect_district_name_read_as_balcony'',',
    E'    ''mon_detect_district_name_read_as_balcony'',\n    ''mon_detect_sadiqeltajer_af_outside_room_list'',');
  if out_def = src then raise exception 'roster anchor not found, refusing to guess where the entry belongs'; end if;
  execute out_def;
end $$;

-- The detector must SEE the rows before the repair.
do $c$
declare k int;
begin
  perform public.mon_detect_sadiqeltajer_af_outside_room_list();
  select count(*) into k from public.alert_event
   where kind = 'sadiqeltajer_af_outside_room_list' and resolved_at is null;
  if k = 0 then raise exception 'detector raised nothing while the rows exist'; end if;
end $c$;

-- The repair: True to NULL, exactly the (row, column) pairs the detector names.
do $r$
declare total int := 0; k int; c text;
begin
  foreach c in array array['kitchen','air_conditioner','parking','furnished','maid_room','driver_room',
                           'private_entrance','laundry_room','elevator','balcony_terrace'] loop
    execute format('update public.sadiqeltajer_residential_listings t set %1$I = null
                     where t.%1$I and exists (select 1 from public.sadiqeltajer_af_outside_room_list() b
                       where b.tbl = %2$L and b.id = t.id and b.col = %3$L)', c, 'sadiqeltajer_residential_listings', c);
    get diagnostics k = row_count; total := total + k;
    execute format('update public.sadiqeltajer_commercial_listings t set %1$I = null
                     where t.%1$I and exists (select 1 from public.sadiqeltajer_af_outside_room_list() b
                       where b.tbl = %2$L and b.id = t.id and b.col = %3$L)', c, 'sadiqeltajer_commercial_listings', c);
    get diagnostics k = row_count; total := total + k;
  end loop;
  if total > 330 then raise exception 'repair touched more values than measured (316): %', total; end if;
  raise notice 'sadiqeltajer values to NULL: %', total;
end $r$;

-- Check: the detector now resolves its own alert.
do $c2$
declare k int;
begin
  perform public.mon_detect_sadiqeltajer_af_outside_room_list();
  select count(*) into k from public.alert_event
   where kind = 'sadiqeltajer_af_outside_room_list' and resolved_at is null;
  if k <> 0 then raise exception 'detector still reports rows after the repair'; end if;
end $c2$;
