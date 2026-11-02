-- 🔬 AF engineer 2026-10-25: a structured amenity statement reaches its column (aouj, aqaralsaudia, alta).
--
-- ops_af_score 2026-10-25 found aouj 0 of 3, aqaralsaudia 0 of 4 and alta 0 of 3. Each site states an amenity in
-- a STRUCTURED field that its parser kept in the payload and never wrote to a column:
--   * aouj         additional_info.garage                       1 or 2 on 4 active ads   -> parking
--   * aqaralsaudia source_capture.REAL_HOMES_property_garage    1 on 11 of 16 active ads -> parking
--   * alta         additional_info.features_ar «مصعد», «غرفة خادمة», «مدخل سيارة» -> elevator, maid_room, car_entrance
-- The parser fixes are PR 8649, 8650 and 8651. This repairs the stored rows from the same payload the parsers read,
-- NULL-only: a value already stored is never touched, and nothing becomes false. A count of 0, an empty count and
-- an unticked term stay NULL, which is silence (ADVANCED_FILTER_SOURCE_TRUTH §2).
--
-- mon_detect_structured_amenity_not_stored() watches the invariant from now on: an active ad whose own structured
-- field says yes while the column is NULL. It goes on the roster in this migration, and the block below proves it
-- raises before the repair and clears after.

create or replace function public.mon_detect_structured_amenity_not_stored()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n        int := 0;
  live     text[] := '{}';
  v_stated bigint;
  v_bad    bigint;
  v_sample jsonb;
begin
  with t as (
    select 'aouj_residential_listings' tbl, id, 'parking' fld,
           coalesce(additional_info->>'garage', '') ~ '^0*[1-9][0-9]*$' stated, parking is null missing
      from public.aouj_residential_listings where active
    union all
    select 'aouj_commercial_listings', id, 'parking',
           coalesce(additional_info->>'garage', '') ~ '^0*[1-9][0-9]*$', parking is null
      from public.aouj_commercial_listings where active
    union all
    select 'aqaralsaudia_residential_listings', id, 'parking',
           coalesce(source_capture->>'REAL_HOMES_property_garage', '') ~ '^0*[1-9][0-9]*$', parking is null
      from public.aqaralsaudia_residential_listings where active
    union all
    select 'aqaralsaudia_commercial_listings', id, 'parking',
           coalesce(source_capture->>'REAL_HOMES_property_garage', '') ~ '^0*[1-9][0-9]*$', parking is null
      from public.aqaralsaudia_commercial_listings where active
    union all
    select 'alta_residential_listings', id, 'elevator',
           coalesce(additional_info->'features_ar', '[]'::jsonb) ? 'مصعد', elevator is null
      from public.alta_residential_listings where active
    union all
    select 'alta_residential_listings', id, 'maid_room',
           coalesce(additional_info->'features_ar', '[]'::jsonb) ? 'غرفة خادمة', maid_room is null
      from public.alta_residential_listings where active
    union all
    select 'alta_residential_listings', id, 'car_entrance',
           coalesce(additional_info->'features_ar', '[]'::jsonb) ? 'مدخل سيارة', car_entrance is null
      from public.alta_residential_listings where active)
  select count(*) filter (where stated),
         count(*) filter (where stated and missing),
         jsonb_agg(jsonb_build_object('t', tbl, 'id', id, 'field', fld)) filter (where stated and missing)
    into v_stated, v_bad, v_sample
    from t;

  -- BLINDNESS GUARD: no active ad on these sites states any of these amenities, so a 0 below proves nothing.
  if v_stated = 0 then
    live := live || 'structured_amenity_not_stored:BLIND'::text;
    n := n + public.mon_raise('P2', 'structured_amenity_not_stored', 'aouj+aqaralsaudia+alta',
      'structured_amenity_not_stored:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No active aouj, aqaralsaudia or alta ad carries a garage count or a ticked feature, so a lost answer cannot be seen.',
        'action', 'Check that the payload keys are still stored: additional_info.garage, source_capture.REAL_HOMES_property_garage, additional_info.features_ar.'));
  elsif v_bad > 0 then
    live := live || 'structured_amenity_not_stored:missing'::text;
    n := n + public.mon_raise('P1', 'structured_amenity_not_stored', 'aouj+aqaralsaudia+alta',
      'structured_amenity_not_stored:missing',
      jsonb_build_object('rows', v_bad, 'stated', v_stated,
        'sample', (select jsonb_agg(x) from (select x from jsonb_array_elements(v_sample) x limit 10) z),
        'why', 'The ad''s own structured field states the amenity and the column is NULL, so a customer asking for it never finds the ad.',
        'action', 'Check the parser still maps it: scrapers/aouj/run.py amenities(), scrapers/aqaralsaudia/run.py garage, scrapers/alta/run.py property_features.'));
  end if;

  perform public.mon_resolve_stale_keys('structured_amenity_not_stored', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_structured_amenity_not_stored' in src) > 0 then
    raise notice 'mon_detect_structured_amenity_not_stored already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_muhaysini_labelled_no_read_as_furnished'',',
    E'    ''mon_detect_muhaysini_labelled_no_read_as_furnished'',\n    ''mon_detect_structured_amenity_not_stored'',');
  if out_def = src then
    raise exception 'roster anchor not found, refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- The detector must SEE the rows before they are repaired.
do $c$
declare k int;
begin
  perform public.mon_detect_structured_amenity_not_stored();
  select count(*) into k from public.alert_event
   where kind = 'structured_amenity_not_stored' and resolved_at is null
     and dedup_key = 'structured_amenity_not_stored:missing';
  if k = 0 then raise exception 'detector raised nothing while stated-but-NULL rows exist'; end if;
end $c$;

-- The repair: NULL-only, from the row's own stored payload.
update public.aouj_residential_listings set parking = true
 where parking is null and coalesce(additional_info->>'garage', '') ~ '^0*[1-9][0-9]*$';
update public.aouj_commercial_listings set parking = true
 where parking is null and coalesce(additional_info->>'garage', '') ~ '^0*[1-9][0-9]*$';
update public.aqaralsaudia_residential_listings set parking = true
 where parking is null and coalesce(source_capture->>'REAL_HOMES_property_garage', '') ~ '^0*[1-9][0-9]*$';
update public.aqaralsaudia_commercial_listings set parking = true
 where parking is null and coalesce(source_capture->>'REAL_HOMES_property_garage', '') ~ '^0*[1-9][0-9]*$';
update public.alta_residential_listings set elevator = true
 where elevator is null and coalesce(additional_info->'features_ar', '[]'::jsonb) ? 'مصعد';
update public.alta_residential_listings set maid_room = true
 where maid_room is null and coalesce(additional_info->'features_ar', '[]'::jsonb) ? 'غرفة خادمة';
update public.alta_residential_listings set car_entrance = true
 where car_entrance is null and coalesce(additional_info->'features_ar', '[]'::jsonb) ? 'مدخل سيارة';

-- …and must clear once they are.
do $c$
declare k int;
begin
  perform public.mon_detect_structured_amenity_not_stored();
  select count(*) into k from public.alert_event
   where kind = 'structured_amenity_not_stored' and resolved_at is null;
  if k > 0 then raise exception 'detector still open after the repair'; end if;
end $c$;
