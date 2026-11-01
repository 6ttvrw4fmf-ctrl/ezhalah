-- 🔬 AF engineer 2026-10-11, backlog 246 (residual). The Nuzul SaaS sites (aldarim, abwbna, alobid,
-- bahadhabab) never print a «no» for a lift, a parking spot, AC or a service: the page shows «المصعد 1»
-- only for a positive count and nothing at 0. Since the 2026-10-09 parser fix every writer maps 0 or a
-- missing key to silence, so no new «no» can be written. 13 active rows still carry the old «no»:
-- 10 were last crawled before the fix, and 3 abwbna land rows whose payload has no such key at all,
-- so the upsert drops the None and keeps the old value. Their stored source_capture holds 0 or nothing
-- for every one of these fields, so the «no» was ours, not the source's. Revert to NULL, never to yes.
do $$
declare t text;
begin
  foreach t in array array['aldarim_residential','aldarim_commercial','abwbna_residential','abwbna_commercial',
                           'alobid_residential','alobid_commercial','bahadhabab_residential','bahadhabab_commercial'] loop
    execute format($q$
      update public.%I_listings x
         set
             elevator        = case when x.elevator        is false and coalesce(nullif(x.source_capture->>'elevators','')::numeric, 0) = 0 then null else x.elevator end,
             parking         = case when x.parking         is false and coalesce(nullif(x.source_capture->>'parking_spots','')::numeric, 0) = 0 then null else x.parking end,
             air_conditioner = case when x.air_conditioner is false and coalesce(nullif(x.source_capture->>'is_ac_installed','')::numeric, 0) = 0 then null else x.air_conditioner end,
             electricity     = case when x.electricity     is false and coalesce(nullif(x.source_capture->>'has_electricity','')::numeric, 0) = 0 then null else x.electricity end,
             water_supply    = case when x.water_supply    is false and coalesce(nullif(x.source_capture->>'has_water','')::numeric, 0) = 0 then null else x.water_supply end,
             sanitation      = case when x.sanitation      is false and coalesce(nullif(x.source_capture->>'has_sewage','')::numeric, 0) = 0 then null else x.sanitation end
       where x.source_capture is not null
         and ((x.elevator is false and coalesce(nullif(x.source_capture->>'elevators','')::numeric, 0) = 0)
              or (x.parking is false and coalesce(nullif(x.source_capture->>'parking_spots','')::numeric, 0) = 0)
              or (x.air_conditioner is false and coalesce(nullif(x.source_capture->>'is_ac_installed','')::numeric, 0) = 0)
              or (x.electricity is false and coalesce(nullif(x.source_capture->>'has_electricity','')::numeric, 0) = 0)
              or (x.water_supply is false and coalesce(nullif(x.source_capture->>'has_water','')::numeric, 0) = 0)
              or (x.sanitation is false and coalesce(nullif(x.source_capture->>'has_sewage','')::numeric, 0) = 0))
    $q$, t);
  end loop;
end $$;

-- The standing watch for this repair: the existing Nuzul SaaS detector (already on the roster) gains a
-- second key. An active row storing «no» for any of the six fields while its own captured payload holds 0
-- or nothing for that field is unknown turned into «no» again.
create or replace function public.mon_detect_aldarim_saas_unfilled_block_false()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  n       int := 0;
  live    text[] := '{}';
  t       text;
  v_rows  bigint;
  v_bad   bigint := 0;
  v_zero  bigint := 0;
  v_seen  bigint := 0;
  v_by    jsonb := '{}'::jsonb;
  v_zby   jsonb := '{}'::jsonb;
begin
  foreach t in array array['aldarim_residential','aldarim_commercial','abwbna_residential','abwbna_commercial',
                           'alobid_residential','alobid_commercial','bahadhabab_residential','bahadhabab_commercial'] loop
    execute format($q$ select count(*) from public.%I_listings where active $q$, t) into v_rows;
    v_seen := v_seen + v_rows;
    execute format($q$
      select count(*) from public.%I_listings x
       where x.active and x.source_capture is not null
         and (x.kitchen is false or x.maid_room is false or x.driver_room is false or x.balcony_terrace is false)
         and not coalesce(x.kitchen or x.maid_room or x.driver_room or x.balcony_terrace, false)
         and coalesce(nullif(x.source_capture->>'bedrooms','')::numeric, 0) = 0
         and coalesce(nullif(x.source_capture->>'bathrooms','')::numeric, 0) = 0
         and coalesce(nullif(x.source_capture->>'living_rooms','')::numeric, 0) = 0
         and coalesce(nullif(x.source_capture->>'kitchens','')::numeric, 0) = 0
    $q$, t) into v_rows;
    if v_rows > 0 then
      v_bad := v_bad + v_rows;
      v_by := v_by || jsonb_build_object(t, v_rows);
    end if;
    execute format($q$
      select count(*) from public.%I_listings x
       where x.active and x.source_capture is not null
         and ((x.elevator is false and coalesce(nullif(x.source_capture->>'elevators','')::numeric, 0) = 0)
              or (x.parking is false and coalesce(nullif(x.source_capture->>'parking_spots','')::numeric, 0) = 0)
              or (x.air_conditioner is false and coalesce(nullif(x.source_capture->>'is_ac_installed','')::numeric, 0) = 0)
              or (x.electricity is false and coalesce(nullif(x.source_capture->>'has_electricity','')::numeric, 0) = 0)
              or (x.water_supply is false and coalesce(nullif(x.source_capture->>'has_water','')::numeric, 0) = 0)
              or (x.sanitation is false and coalesce(nullif(x.source_capture->>'has_sewage','')::numeric, 0) = 0))
    $q$, t) into v_rows;
    if v_rows > 0 then
      v_zero := v_zero + v_rows;
      v_zby := v_zby || jsonb_build_object(t, v_rows);
    end if;
  end loop;

  -- BLINDNESS GUARD: with no active row on any of the four sites a 0 proves nothing.
  if v_seen = 0 then
    live := live || 'aldarim_saas_unfilled_block_false:BLIND'::text;
    n := n + public.mon_raise('P2', 'aldarim_saas_unfilled_block_false', 'aldarim',
      'aldarim_saas_unfilled_block_false:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No active listing on aldarim/abwbna/alobid/bahadhabab, so this detector cannot see '
            || 'whether an unfilled room block is still stored as «no».',
        'action', 'Fix the aldarim-SaaS crawls first.'));
  else
    if v_bad > 0 then
      live := live || 'aldarim_saas_unfilled_block_false:false_from_silence'::text;
      n := n + public.mon_raise('P1', 'aldarim_saas_unfilled_block_false', 'aldarim',
        'aldarim_saas_unfilled_block_false:false_from_silence',
        jsonb_build_object('rows', v_bad, 'by_table', v_by,
          'why', 'An unfilled room block (all 0) is stored as kitchen/maid/driver/balcony = false: unknown became «no», '
              || 'so the Advanced Filter hides these listings from a customer who asks for the amenity.',
          'action', 'The scraper must call normalize.silence_unfilled_room_block; then revert the rows to NULL as 20261005094209 did.'));
    end if;
    if v_zero > 0 then
      live := live || 'aldarim_saas_unfilled_block_false:zero_amenity_as_no'::text;
      n := n + public.mon_raise('P1', 'aldarim_saas_unfilled_block_false', 'aldarim',
        'aldarim_saas_unfilled_block_false:zero_amenity_as_no',
        jsonb_build_object('rows', v_zero, 'by_table', v_zby,
          'why', 'A lift, parking, AC or service is stored «no» while the ad''s own payload holds 0 or nothing for it. '
              || 'These sites never print a «no», so unknown became «no» (backlog 246).',
          'action', 'Every writer must map 0 and missing to silence through _yes_or_silence; revert the rows to NULL.'));
    end if;
  end if;

  perform public.mon_resolve_stale_keys('aldarim_saas_unfilled_block_false', live);
  return n;
end
$function$;
