-- 🔬 AF engineer 2026-10-08: barrier for the sanadak unticked-box repair (20261008095541).
-- Fires when a sanadak listing is served — or would be served by the next sync — with driver_room / pool /
-- gym / garden = false. sanadak's payload sets these false on every ad whose advertiser skipped the feature
-- form, so a false there is never the source's statement (ADVANCED_FILTER_SOURCE_TRUTH §1).
create or replace function public.mon_detect_sanadak_unticked_box_as_no()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n       int := 0;
  live    text[] := '{}';
  v_seen  bigint;
  v_srv   bigint;
  v_view  bigint;
begin
  select count(*) into v_seen from public.search_listings_ar where platform = 'sanadak';
  select count(*) into v_srv from public.search_listings_ar
   where platform = 'sanadak'
     and (driver_room is false or pool is false or gym is false or garden is false);
  select count(*) into v_view from public.listing_extra_attrs_v0
   where source_table like 'sanadak%' and driver_room is false;
  select v_view + count(*) into v_view from public.listing_rich_attrs
   where source_table like 'sanadak%' and (pool is false or gym is false or garden is false);

  -- BLINDNESS GUARD: with no served sanadak row a 0 proves nothing.
  if v_seen = 0 then
    live := live || 'sanadak_unticked_box_as_no:BLIND'::text;
    n := n + public.mon_raise('P2', 'sanadak_unticked_box_as_no', 'sanadak',
      'sanadak_unticked_box_as_no:BLIND',
      jsonb_build_object('blind', true,
        'why', 'No sanadak listing is served, so this detector cannot see whether an unticked feature box is served as «no».',
        'action', 'Fix the sanadak crawl / sync first.'));
  elsif v_srv > 0 or v_view > 0 then
    live := live || 'sanadak_unticked_box_as_no:false_served'::text;
    n := n + public.mon_raise('P1', 'sanadak_unticked_box_as_no', 'sanadak',
      'sanadak_unticked_box_as_no:false_served',
      jsonb_build_object('served_rows', v_srv, 'view_rows', v_view,
        'why', 'sanadak sets isDriverRoomAvailable / isSwimmingPoolAvailable / isGymAvailable / isGardenAvailable false on every ad '
            || 'whose advertiser skipped the feature form (its page then prints no feature grid), so a false is unknown, never «no».',
        'action', 'listing_extra_attrs_v0 / listing_rich_attrs must map those keys false -> NULL (migration 20261008095541); '
            || 're-apply that change and re-derive search_listings_ar for platform sanadak.'));
  end if;

  perform public.mon_resolve_stale_keys('sanadak_unticked_box_as_no', live);
  return n;
end
$function$;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_sanadak_unticked_box_as_no' in src) > 0 then
    raise notice 'mon_detect_sanadak_unticked_box_as_no already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_sakan_prepared_elevator_as_yes'',',
    E'    ''mon_detect_sakan_prepared_elevator_as_yes'',\n    ''mon_detect_sanadak_unticked_box_as_no'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

do $$
begin
  if public.mon_detect_sanadak_unticked_box_as_no() <> 0 then
    raise exception 'repair did not land: the detector still finds a sanadak unticked box served as no';
  end if;
end $$;
