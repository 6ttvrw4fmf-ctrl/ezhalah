-- The by-pin arm of retired_place_remap_rows() ignores a REGISTERED DEFAULT point (an office / city-centre pair a
-- site prints under many ads), not only a missing pin (CodeRabbit #11808, 🆕 2026-11-11). The :15 strip removes such
-- a point from the source, but the hourly correction refresh could still read it from the index for one cycle and,
-- if it sits within 15 km of the town, move an effectively unpinned home. Measured at apply time: 0 of the 32 by-pin
-- moves sit on a registered default, so this changes nothing today; it keeps the gate honest.
-- Needle edit of the LIVE body (one exact replace, or fail); the check block executes the function both ways.
do $mig$
declare src text; dst text;
  needle constant text := E'       and s.latitude is not null and s.longitude is not null\n';
  repl constant text := E'       and s.latitude is not null and s.longitude is not null\n'
                     || E'       and not exists (select 1 from public.ops_default_pin_register g\n'
                     || E'                        where g.source_table = s.source_table\n'
                     || E'                          and g.lat = round(s.latitude::numeric, 5)\n'
                     || E'                          and g.lng = round(s.longitude::numeric, 5))\n';
begin
  src := pg_get_functiondef('public.retired_place_remap_rows()'::regprocedure);
  if position(needle in src) = 0 then raise exception 'needle not found in live retired_place_remap_rows()'; end if;
  if position('ops_default_pin_register' in src) > 0 then raise exception 'default-pin gate already present'; end if;
  dst := replace(src, needle, repl);
  if length(dst) - length(src) <> length(repl) - length(needle) then raise exception 'needle matched more than once'; end if;
  execute dst;
end
$mig$;

do $chk$
declare bad int;
begin
  if position('ops_default_pin_register' in pg_get_functiondef('public.retired_place_remap_rows()'::regprocedure)) = 0 then
    raise exception 'default-pin gate did not land';
  end if;
  if not exists (select 1 from public.retired_place_remap_rows()
                  where source_table = 'arkaan_residential_listings' and listing_id = 26298570 and new_city_id = 3700) then
    raise exception 'arkaan 26298570 no longer moves to جواثا (3700)';
  end if;
  select count(*) into bad from public.retired_place_remap_rows() r
    join public.search_listings_ar s using (source_table, listing_id)
    join public.ops_default_pin_register g on g.source_table = s.source_table
     and g.lat = round(s.latitude::numeric, 5) and g.lng = round(s.longitude::numeric, 5)
   where r.kind = 'district_is_city_by_pin';
  if bad > 0 then raise exception '% by-pin moves still ride a registered default point', bad; end if;
end
$chk$;
