-- mon_detect_jazan_label_pin_far_north skips rows already adjudicated in ops_far_pin_register (2026-10-22).
-- After the Bahrah re-file two single ads remained, each a SOURCE contradiction rather than a twin-city
-- misfile: ialqarawi 12591422 names «الواسط» (Jazan) with a pin at Al-Sail near Taif, and sanadak 9186075 names
-- «اللخبصية» (Jazan, 18 other ads at 17.9 N) with a REGA pin at 29.9 N. The owner's «A» rule (2026-10-20) is that
-- the city label wins over a far pin; both are registered there, so the detector must not stay red on them.
create or replace function public.mon_detect_jazan_label_pin_far_north()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n int := 0; live text[] := '{}'; v bigint; ex text;
begin
  -- Jazan region spans ~16.3–18.6 N. A Jazan-labelled ad whose OWN pin is north of 19.5 N is filed in the
  -- wrong region (the Bahrah twin, 2026-10-22), unless it is already adjudicated as a far pin.
  select count(*), min(s.source_table || ':' || s.listing_id) into v, ex
    from public.search_listings_ar s
   where s.production_ready and s.region_id = 10 and s.latitude > 19.5
     and not exists (select 1 from public.ops_far_pin_register f
                      where f.source_table = s.source_table and f.listing_id = s.listing_id);
  if v > 0 then
    live := live || 'jazan_label_pin_far_north:rows'::text;
    n := n + public.mon_raise('P1', 'jazan_label_pin_far_north', 'fleet', 'jazan_label_pin_far_north:rows',
      jsonb_build_object('rows', v, 'example', ex,
        'why', 'An ad filed under Jazan region has its own pin far north of Jazan: a same-name city resolved to the wrong region.',
        'action', 'Check the city name against loc_catalog_city twins; give the right city a loc_catalog_city_alias and re-file the rows. A single ad whose own source contradicts itself goes in ops_far_pin_register.'));
  end if;
  perform public.mon_resolve_stale_keys('jazan_label_pin_far_north', live);
  return n;
end
$function$;
